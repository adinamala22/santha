import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutBucketPolicyCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { DomainError } from '../../common/errors/domain-error';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

export interface PresignedUpload {
  /** Absolute URL, or a path starting with "/" that clients resolve against the API base URL. */
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
}

/**
 * Object storage port for uploaded images: S3 (AWS ap-south-1 / RustFS locally) or in-memory
 * (fake mode). Clients upload straight to a presigned URL; the API then reads the original,
 * makes WebP variants and writes them back (media pipeline).
 */
export abstract class ObjectStorage {
  abstract presignPut(key: string, contentType: string, ttlSec?: number): Promise<PresignedUpload>;
  abstract get(key: string): Promise<Buffer | null>;
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Public (CDN) URL of a stored object — absolute, or "/"-relative to the API in fake mode. */
  abstract publicUrl(key: string): string;
}

@Injectable()
export class S3ObjectStorage extends ObjectStorage {
  private readonly logger = new Logger('S3ObjectStorage');
  private readonly client: S3Client;
  private bucketChecked = false;

  constructor(private readonly env: Env) {
    super();
    this.client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
      ...(env.S3_ACCESS_KEY && env.S3_SECRET_KEY ? { credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } } : {}),
    });
  }

  private bucket(): string {
    if (!this.env.S3_BUCKET) throw new DomainError('PROVIDER_UNAVAILABLE', 'Image uploads are not configured on this server.');
    return this.env.S3_BUCKET;
  }

  /**
   * Local dev convenience (never in AWS, where Terraform owns the bucket and CloudFront serves
   * media/ through origin access): RustFS starts empty, so create the bucket on first use and let
   * anyone read the processed renditions under media/ (originals stay private).
   */
  private async ensureBucket(): Promise<void> {
    if (this.bucketChecked || this.env.APP_ENV !== 'dev') return;
    const Bucket = this.bucket();
    try {
      await this.client.send(new HeadBucketCommand({ Bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket })).catch((e: Error) => this.logger.warn(e.message));
    }
    const policy = {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${Bucket}/media/*`] }],
    };
    await this.client.send(new PutBucketPolicyCommand({ Bucket, Policy: JSON.stringify(policy) })).catch((e: Error) => this.logger.warn(`bucket policy: ${e.message}`));
    this.bucketChecked = true;
  }

  async presignPut(key: string, contentType: string, ttlSec = 900): Promise<PresignedUpload> {
    await this.ensureBucket();
    const url = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket(), Key: key, ContentType: contentType }), { expiresIn: ttlSec });
    return { url, method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt: new Date(Date.now() + ttlSec * 1000) };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket(), Key: key }));
      return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket(), Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }),
    );
  }

  publicUrl(key: string): string {
    const base = this.env.CDN_BASE_URL ?? `${this.env.S3_ENDPOINT ?? ''}/${this.env.S3_BUCKET ?? ''}`;
    return `${base.replace(/\/$/, '')}/${key}`;
  }
}

/**
 * Fake mode: objects live in process memory. Uploads go to the API's dev route
 * (`PUT /v1/dev/uploads?key=…&sig=…`, HMAC-signed with a per-process secret) and images are served
 * from `GET /v1/dev/media/<key>`. Lost on restart, like the rest of fake mode.
 */
@Injectable()
export class MemoryObjectStorage extends ObjectStorage {
  private readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  private readonly secret = randomBytes(32);

  sign(key: string, contentType: string, expires: number): string {
    return createHmac('sha256', this.secret).update(`${key}\n${contentType}\n${expires}`).digest('hex');
  }

  async presignPut(key: string, contentType: string, ttlSec = 900): Promise<PresignedUpload> {
    const expires = Date.now() + ttlSec * 1000;
    const qs = new URLSearchParams({ key, ct: contentType, exp: String(expires), sig: this.sign(key, contentType, expires) });
    return { url: `/v1/dev/uploads?${qs}`, method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt: new Date(expires) };
  }

  verify(key: string, contentType: string, expires: number, sig: string): boolean {
    return expires > Date.now() && sig === this.sign(key, contentType, expires);
  }

  async get(key: string): Promise<Buffer | null> {
    return this.objects.get(key)?.body ?? null;
  }

  entry(key: string): { body: Buffer; contentType: string } | null {
    return this.objects.get(key) ?? null;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  publicUrl(key: string): string {
    return `/v1/dev/media/${key}`;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: ObjectStorage,
      inject: [ENV],
      useFactory: (env: Env) => (env.DATA_STORE === 'memory' ? new MemoryObjectStorage() : new S3ObjectStorage(env)),
    },
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}

