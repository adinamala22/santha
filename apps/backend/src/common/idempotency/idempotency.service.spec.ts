import { describe, expect, it } from 'vitest';
import { MemoryKvCache } from '../../infra/cache/kv-cache';
import { DomainError } from '../errors/domain-error';
import { fingerprint, IdempotencyService } from './idempotency.service';

const svc = () => new IdempotencyService(new MemoryKvCache());

describe('IdempotencyService', () => {
  it('runs once and replays the first response for the same key and body', async () => {
    const s = svc();
    let calls = 0;
    const fn = async () => ({ id: `order-${++calls}` });
    const a = await s.run('orders', 'u1', 'key-00000001', { q: 1 }, fn);
    const b = await s.run('orders', 'u1', 'key-00000001', { q: 1 }, fn);
    expect(a).toEqual({ value: { id: 'order-1' }, replayed: false });
    expect(b).toEqual({ value: { id: 'order-1' }, replayed: true });
    expect(calls).toBe(1);
  });

  it('scopes keys per user and per scope', async () => {
    const s = svc();
    let calls = 0;
    const fn = async () => ++calls;
    await s.run('orders', 'u1', 'key-00000001', {}, fn);
    await s.run('orders', 'u2', 'key-00000001', {}, fn);
    await s.run('payments', 'u1', 'key-00000001', {}, fn);
    expect(calls).toBe(3);
  });

  it('rejects a missing/short key, a different body, and a concurrent duplicate', async () => {
    const s = svc();
    await expect(s.run('orders', 'u1', undefined, {}, async () => 1)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    await expect(s.run('orders', 'u1', 'short', {}, async () => 1)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    await s.run('orders', 'u1', 'key-00000002', { a: 1 }, async () => 1);
    await expect(s.run('orders', 'u1', 'key-00000002', { a: 2 }, async () => 1)).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });

    let release!: () => void;
    const slow = s.run('orders', 'u1', 'key-00000003', {}, () => new Promise<number>((r) => (release = () => r(1))));
    await expect(s.run('orders', 'u1', 'key-00000003', {}, async () => 2)).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
    release();
    await expect(slow).resolves.toEqual({ value: 1, replayed: false });
  });

  it('does not store failures, so the client can retry with the same key', async () => {
    const s = svc();
    await expect(s.run('orders', 'u1', 'key-00000004', {}, async () => { throw new DomainError('NOT_PLACEABLE', 'no'); })).rejects.toBeInstanceOf(DomainError);
    await expect(s.run('orders', 'u1', 'key-00000004', {}, async () => 'ok')).resolves.toEqual({ value: 'ok', replayed: false });
  });

  it('fingerprints ignore key order', () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});
