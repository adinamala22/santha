import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { CLOCK, type Clock } from '../../common/clock';
import { DomainError } from '../../common/errors/domain-error';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { type PresignedUpload, ObjectStorage } from '../../infra/storage/object-storage';
import { CatalogueRepository } from './catalogue.repository';
import type { MediaRecord, MediaVariant } from './domain/catalogue';

export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];

/** Tech plan 6.2: list thumbnails ≤ 40 KB WebP; detail images 800 px. */
export const THUMB = { size: 320, maxBytes: 40 * 1024 };
export const MEDIUM = { size: 960 };
const MIN_SIDE = 200;

export interface MediaView {
  id: string;
  purpose: MediaRecord['purpose'];
  status: MediaRecord['status'];
  rejectReason: string | null;
  thumbUrl: string | null;
  mediumUrl: string | null;
  createdAt: Date;
}

export interface Actor {
  userId: string;
  requestId?: string | null;
}

/**
 * Image pipeline (tech plan 6.2): the app asks for a presigned upload, PUTs the original straight
 * to storage, then calls complete; we validate it, make WebP thumb + medium renditions with Sharp
 * and put the image in the moderation queue. Consumers only ever see approved images.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly repo: CatalogueRepository,
    private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async requestUpload(merchantId: string, uploadedBy: string, purpose: MediaRecord['purpose'], contentType: string): Promise<{ media: MediaView; upload: PresignedUpload }> {
    if (!(UPLOAD_TYPES as readonly string[]).includes(contentType))
      throw new DomainError('VALIDATION_FAILED', 'Upload a JPEG, PNG or WebP photo.', { contentType });
    const originalKey = `originals/${merchantId}/${randomUUID()}`;
    const media = await this.repo.transaction((tx) =>
      tx.createMedia({ merchantId, purpose, status: 'uploading', contentType, originalKey, uploadedBy }),
    );
    return { media: this.view(media), upload: await this.storage.presignPut(originalKey, contentType) };
  }

  /** Called after the client PUT the original. Idempotent once processed. */
  async complete(merchantId: string, mediaId: string, actor: Actor): Promise<MediaView> {
    const m = await this.repo.getMedia(mediaId);
    if (!m || m.merchantId !== merchantId) throw new DomainError('NOT_FOUND', 'Photo not found');
    if (m.status !== 'uploading') return this.view(m);
    const original = await this.storage.get(m.originalKey);
    if (!original) throw new DomainError('INVALID_STATE', 'The photo has not finished uploading. Try again.');
    if (original.length > this.env.MAX_UPLOAD_BYTES) throw new DomainError('VALIDATION_FAILED', 'This photo is too large (8 MB max).');
    const variants = await this.render(original, `media/${merchantId}/${m.id}`);
    return this.view(
      await this.repo.transaction(async (tx) => {
        const updated = await tx.updateMedia(m.id, { status: 'pending_review', variants });
        await tx.appendEvent({
          type: 'media.uploaded',
          aggregate: { type: 'media', id: m.id },
          actor: { type: 'user', id: actor.userId },
          payload: { media_id: m.id, merchant_id: merchantId, purpose: m.purpose },
        });
        return updated;
      }),
    );
  }

  /** Decode, auto-orient, strip metadata and write WebP renditions. Rejects non-images and tiny images. */
  async render(original: Buffer, keyPrefix: string): Promise<NonNullable<MediaRecord['variants']>> {
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try {
      meta = await sharp(original).metadata();
    } catch {
      throw new DomainError('VALIDATION_FAILED', 'This file is not a photo we can read.');
    }
    if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < MIN_SIDE)
      throw new DomainError('VALIDATION_FAILED', `Photos must be at least ${MIN_SIDE} × ${MIN_SIDE} pixels.`);

    const thumb = await this.thumb(original);
    const medium = await sharp(original).rotate().resize(MEDIUM.size, MEDIUM.size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer({ resolveWithObject: true });
    const out = {
      thumb: { key: `${keyPrefix}/thumb.webp`, width: thumb.info.width, height: thumb.info.height, bytes: thumb.data.length },
      medium: { key: `${keyPrefix}/medium.webp`, width: medium.info.width, height: medium.info.height, bytes: medium.data.length },
    } satisfies Record<string, MediaVariant>;
    await this.storage.put(out.thumb.key, thumb.data, 'image/webp');
    await this.storage.put(out.medium.key, medium.data, 'image/webp');
    return out;
  }

  /** Square thumbnail, quality stepped down until it fits the 40 KB budget. */
  private async thumb(original: Buffer) {
    for (const quality of [72, 60, 48, 36]) {
      const r = await sharp(original).rotate().resize(THUMB.size, THUMB.size, { fit: 'cover', position: 'attention' }).webp({ quality }).toBuffer({ resolveWithObject: true });
      if (r.data.length <= THUMB.maxBytes || quality === 36) return r;
    }
    throw new Error('unreachable');
  }

  async review(mediaId: string, decision: 'approve' | 'reject', actor: Actor, reason?: string): Promise<MediaView> {
    const m = await this.repo.getMedia(mediaId);
    if (!m) throw new DomainError('NOT_FOUND', 'Photo not found');
    if (m.status === 'uploading') throw new DomainError('INVALID_STATE', 'This photo has not finished uploading.');
    const status = decision === 'approve' ? 'approved' : 'rejected';
    if (m.status === status) return this.view(m);
    return this.view(
      await this.repo.transaction(async (tx) => {
        const updated = await tx.updateMedia(m.id, { status, rejectReason: decision === 'reject' ? (reason?.trim() || 'Not suitable') : null, reviewedBy: actor.userId, reviewedAt: this.clock() });
        await tx.appendEvent({
          type: decision === 'approve' ? 'media.approved' : 'media.rejected',
          aggregate: { type: 'media', id: m.id },
          actor: { type: 'ops', id: actor.userId },
          payload: { media_id: m.id, merchant_id: m.merchantId, purpose: m.purpose },
        });
        await tx.appendAudit({
          entity: 'media',
          entityId: m.id,
          action: decision === 'approve' ? 'approved' : 'rejected',
          actorId: actor.userId,
          before: { status: m.status },
          after: { status, ...(decision === 'reject' ? { reason: updated.rejectReason } : {}) },
          requestId: actor.requestId ?? null,
        });
        return updated;
      }),
    );
  }

  queue(limit = 100): Promise<MediaRecord[]> {
    return this.repo.listMedia({ status: 'pending_review', limit });
  }

  async views(ids: string[]): Promise<MediaView[]> {
    const rows = await this.repo.mediaByIds(ids);
    return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is MediaRecord => !!r).map((r) => this.view(r));
  }

  /** Every media id must be this merchant's, processed (not still uploading) and for `purpose`. */
  async assertUsable(merchantId: string, ids: string[], purpose: MediaRecord['purpose']): Promise<void> {
    const rows = await this.repo.mediaByIds(ids);
    for (const id of ids) {
      const m = rows.find((r) => r.id === id);
      if (!m || m.merchantId !== merchantId || m.purpose !== purpose) throw new DomainError('VALIDATION_FAILED', 'One of the photos was not found.', { mediaId: id });
      if (m.status === 'uploading') throw new DomainError('INVALID_STATE', 'Wait for the photo to finish uploading.', { mediaId: id });
      if (m.status === 'rejected') throw new DomainError('VALIDATION_FAILED', 'One of the photos was rejected. Choose another.', { mediaId: id });
    }
  }

  view(m: MediaRecord): MediaView {
    return {
      id: m.id,
      purpose: m.purpose,
      status: m.status,
      rejectReason: m.rejectReason,
      thumbUrl: m.variants ? this.storage.publicUrl(m.variants.thumb.key) : null,
      mediumUrl: m.variants ? this.storage.publicUrl(m.variants.medium.key) : null,
      createdAt: m.createdAt,
    };
  }
}
