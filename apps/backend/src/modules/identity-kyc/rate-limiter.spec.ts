import { describe, expect, it } from 'vitest';
import { MemoryRateLimiter } from './rate-limiter';

describe('MemoryRateLimiter (fake mode)', () => {
  it('limits within a fixed window and resets after it', async () => {
    let t = 0;
    const rl = new MemoryRateLimiter(() => t);
    expect(await rl.hit('k', 2, 60)).toEqual({ allowed: true, retryAfterSec: 0 });
    expect((await rl.hit('k', 2, 60)).allowed).toBe(true);
    t = 15_000;
    expect(await rl.hit('k', 2, 60)).toEqual({ allowed: false, retryAfterSec: 45 });
    expect((await rl.hit('other', 2, 60)).allowed).toBe(true);
    t = 60_000;
    expect((await rl.hit('k', 2, 60)).allowed).toBe(true);
  });
});
