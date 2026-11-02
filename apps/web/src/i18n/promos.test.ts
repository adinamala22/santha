import { describe, expect, it } from 'vitest';
import { promoMessages } from './promos';

const keys = (o: unknown, p = ''): string[] =>
  typeof o === 'string' ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, `${p}.${k}`));
const get = (root: object, k: string) => k.split('.').filter(Boolean).reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], root) as string;

describe('promo console copy', () => {
  it('has a Telugu string for every English string', () => {
    expect(keys(promoMessages.te).sort()).toEqual(keys(promoMessages.en).sort());
  });

  it('keeps placeholders identical across languages, and Telugu is actually translated', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys(promoMessages.en)) {
      expect(ph(get(promoMessages.te, k)), k).toBe(ph(get(promoMessages.en, k)));
    }
    const telugu = keys(promoMessages.te).filter((k) => /[ఀ-౿]/.test(get(promoMessages.te, k)));
    expect(telugu.length / keys(promoMessages.te).length).toBeGreaterThan(0.85);
  });
});
