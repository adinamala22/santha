import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../config/env';
import { isAwsS3, S3ObjectStorage } from './object-storage';

const base = { ...process.env, S3_BUCKET: 'santha-prod-media', S3_REGION: 'ap-south-1' };

describe('S3ObjectStorage addressing (ADR-042)', () => {
  it('knows Amazon S3 endpoints from the others', () => {
    expect(isAwsS3('https://s3.ap-south-1.amazonaws.com')).toBe(true);
    expect(isAwsS3('https://blr1.digitaloceanspaces.com')).toBe(false);
    expect(isAwsS3('https://media.test.santhaapp.com')).toBe(false);
    expect(isAwsS3(undefined)).toBe(false);
  });

  it('public photo links on Amazon S3 are virtual-hosted, on other hosts path style, and a CDN wins', () => {
    const aws = new S3ObjectStorage(parseEnv({ ...base, S3_ENDPOINT: 'https://s3.ap-south-1.amazonaws.com' }));
    expect(aws.publicUrl('media/a/b.webp')).toBe('https://santha-prod-media.s3.ap-south-1.amazonaws.com/media/a/b.webp');
    const spaces = new S3ObjectStorage(parseEnv({ ...base, S3_ENDPOINT: 'https://blr1.digitaloceanspaces.com' }));
    expect(spaces.publicUrl('media/a/b.webp')).toBe('https://blr1.digitaloceanspaces.com/santha-prod-media/media/a/b.webp');
    const cdn = new S3ObjectStorage(parseEnv({ ...base, S3_ENDPOINT: 'https://s3.ap-south-1.amazonaws.com', CDN_BASE_URL: 'https://cdn.santhaapp.com' }));
    expect(cdn.publicUrl('media/a/b.webp')).toBe('https://cdn.santhaapp.com/media/a/b.webp');
  });
});
