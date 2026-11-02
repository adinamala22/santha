import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { KvCache } from '../../infra/cache/kv-cache';
import { DomainError } from '../errors/domain-error';

/** Keys are kept 24 h with the first response (architecture invariant). */
export const IDEMPOTENCY_TTL_SEC = 24 * 3600;
/** A request holding the key this long without finishing is treated as abandoned. */
const PENDING_TTL_SEC = 60;
const KEY_RE = /^[A-Za-z0-9_:.-]{8,100}$/;

type Entry<T> = { state: 'pending'; fp: string } | { state: 'done'; fp: string; value: T };

/** Stable fingerprint of a request body, so a reused key with a different body is caught. */
export function fingerprint(body: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v;
  return createHash('sha256').update(JSON.stringify(sorted(body ?? null))).digest('hex');
}

/**
 * Idempotency for money and order POSTs (POST /orders, payment confirmation, refunds): the first
 * successful response for (scope, user, key) is stored for 24 h and replayed for retries. A retry
 * while the first request is still running gets 409; the same key with a different body gets 422.
 * Failures are not stored, so the client may retry with the same key. Redis in production, an
 * in-process map in fake mode (KvCache).
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly kv: KvCache) {}

  async run<T>(scope: string, userId: string, key: string | undefined, body: unknown, fn: () => Promise<T>): Promise<{ value: T; replayed: boolean }> {
    if (!key || !KEY_RE.test(key))
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (8–100 letters, digits, - _ : .).');
    const k = `idem:${scope}:${userId}:${key}`;
    const fp = fingerprint(body);

    const claimed = await this.kv.setIfAbsent<Entry<T>>(k, { state: 'pending', fp }, PENDING_TTL_SEC);
    if (!claimed) {
      const existing = await this.kv.get<Entry<T>>(k);
      if (existing) {
        if (existing.fp !== fp) throw new DomainError('IDEMPOTENCY_MISMATCH', 'This Idempotency-Key was already used for a different request.');
        if (existing.state === 'done') return { value: existing.value, replayed: true };
        throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'The same request is still being processed. Try again in a moment.');
      }
      // Expired between the two calls: claim it now.
      if (!(await this.kv.setIfAbsent<Entry<T>>(k, { state: 'pending', fp }, PENDING_TTL_SEC)))
        throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'The same request is still being processed. Try again in a moment.');
    }

    try {
      const value = await fn();
      await this.kv.set<Entry<T>>(k, { state: 'done', fp, value }, IDEMPOTENCY_TTL_SEC);
      return { value, replayed: false };
    } catch (err) {
      await this.kv.delete(k);
      throw err;
    }
  }
}
