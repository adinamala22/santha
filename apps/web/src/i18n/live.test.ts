import { describe, expect, it } from 'vitest';
import { liveMessages } from './live';

const keys = (o: unknown, p = ''): string[] =>
  typeof o === 'string' ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, `${p}.${k}`));
const get = (root: object, k: string) => k.split('.').filter(Boolean).reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], root) as string;

describe('live board copy', () => {
  it('has a Telugu string for every English string', () => {
    expect(keys(liveMessages.te).sort()).toEqual(keys(liveMessages.en).sort());
  });

  it('keeps placeholders identical across languages, and Telugu is actually translated', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys(liveMessages.en)) {
      expect(ph(get(liveMessages.te, k)), k).toBe(ph(get(liveMessages.en, k)));
    }
    const telugu = keys(liveMessages.te).filter((k) => /[ఀ-౿]/.test(get(liveMessages.te, k)));
    expect(telugu.length / keys(liveMessages.te).length).toBeGreaterThan(0.75);
  });
});
