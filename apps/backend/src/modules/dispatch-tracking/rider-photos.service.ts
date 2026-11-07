import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { DomainError } from '../../common/errors/domain-error';
import { ObjectStorage, PRIVATE_PREFIX, type PresignedUpload } from '../../infra/storage/object-storage';
import { UPLOAD_TYPES } from '../merchant-catalogue/media.service';
import { DispatchRepository, type RiderPhotoKind, type RiderPhotoRecord } from './dispatch.repository';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SIDE = 1280;
const MIN_SIDE = 200;
/** Sign-up photos can change only while the rider's details are editable. */
const EDITABLE = ['draft', 'rejected'];

/**
 * Private rider photos (ADR-030): a selfie and the driving licence card at sign-up, and a photo at the door as
 * proof of delivery. Same upload flow as merchant media (presigned PUT, then complete), but stored under
 * private/ and never public: ops and the order's customer get short-lived signed links.
 */
@Injectable()
export class RiderPhotosService {
  constructor(
    private readonly repo: DispatchRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async request(
    riderUserId: string,
    input: { kind: RiderPhotoKind; contentType: string; fulfilmentId?: string | undefined },
  ): Promise<{ photo: RiderPhotoRecord; upload: PresignedUpload }> {
    if (!(UPLOAD_TYPES as readonly string[]).includes(input.contentType))
      throw new DomainError('VALIDATION_FAILED', 'Upload a JPEG, PNG or WebP photo.', { field: 'contentType' });
    let fulfilmentId: string | null = null;
    if (input.kind === 'delivery') {
      const f = input.fulfilmentId ? await this.repo.fulfilment(input.fulfilmentId) : null;
      if (!f || f.riderUserId !== riderUserId) throw new DomainError('NOT_FOUND', 'Delivery not found');
      if (f.state !== 'picked_up') throw new DomainError('INVALID_STATE', 'Take the door photo while delivering the order.');
      fulfilmentId = f.id;
    } else {
      const r = await this.repo.getRider(riderUserId);
      if (!r || !EDITABLE.includes(r.status))
        throw new DomainError('INVALID_STATE', 'Your details are locked while under review or after approval.');
    }
    const id = randomUUID();
    const photo = await this.repo.createPhoto({
      id,
      riderUserId,
      kind: input.kind,
      fulfilmentId,
      status: 'uploading',
      contentType: input.contentType,
      originalKey: `${PRIVATE_PREFIX}originals/riders/${riderUserId}/${id}`,
      key: null,
    });
    return { photo, upload: await this.storage.presignPut(photo.originalKey, input.contentType) };
  }

  /** After the PUT: decode, auto-orient, strip metadata, shrink, store privately. Idempotent once ready. */
  async complete(riderUserId: string, id: string): Promise<RiderPhotoRecord> {
    const p = await this.repo.photo(id);
    if (!p || p.riderUserId !== riderUserId) throw new DomainError('NOT_FOUND', 'Photo not found');
    if (p.status === 'ready') return p;
    const original = await this.storage.get(p.originalKey);
    if (!original) throw new DomainError('INVALID_STATE', 'The photo has not finished uploading. Try again.');
    if (original.length > MAX_BYTES) throw new DomainError('VALIDATION_FAILED', 'This photo is too large (8 MB max).');
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try {
      meta = await sharp(original).metadata();
    } catch {
      throw new DomainError('VALIDATION_FAILED', 'This file is not a photo we can read.');
    }
    if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < MIN_SIDE)
      throw new DomainError('VALIDATION_FAILED', `Photos must be at least ${MIN_SIDE} × ${MIN_SIDE} pixels.`);
    const out = await sharp(original).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    const key = `${PRIVATE_PREFIX}riders/${riderUserId}/${p.id}.webp`;
    await this.storage.put(key, out, 'image/webp');
    return (await this.repo.updatePhoto(p.id, { status: 'ready', key }))!;
  }

  /** The newest ready photo of a kind (sign-up photos can be retaken). */
  async latest(riderUserId: string, kind: RiderPhotoKind): Promise<RiderPhotoRecord | null> {
    return (await this.repo.riderPhotos(riderUserId, kind))[0] ?? null;
  }

  /** A door photo usable as proof for this delivery: this rider's, for this job, processed. */
  async deliveryProof(riderUserId: string, fulfilmentId: string, photoId: string): Promise<RiderPhotoRecord> {
    const p = await this.repo.photo(photoId);
    if (!p || p.riderUserId !== riderUserId || p.kind !== 'delivery' || p.fulfilmentId !== fulfilmentId || p.status !== 'ready')
      throw new DomainError('VALIDATION_FAILED', 'Take the door photo again.', { field: 'photoMediaId' });
    return p;
  }

  /** Short-lived link (5 min) for ops or the order's customer. */
  async url(p: RiderPhotoRecord | null): Promise<string | null> {
    return p?.key ? this.storage.presignGet(p.key) : null;
  }

  async urlById(id: string | null): Promise<string | null> {
    return id ? this.url(await this.repo.photo(id)) : null;
  }
}
