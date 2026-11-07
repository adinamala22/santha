import { describe, expect, it } from 'vitest';
import { ridersMessages } from './riders';

const keys = (o: unknown, p = ''): string[] =>
  typeof o === 'string' ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, `${p}.${k}`));
const get = (root: object, k: string) => k.split('.').filter(Boolean).reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], root) as string;

describe('rider sign-up copy', () => {
  it('has a Telugu string for every English string', () => {
    expect(keys(ridersMessages.te).sort()).toEqual(keys(ridersMessages.en).sort());
  });

  it('keeps placeholders identical across languages, and Telugu is actually translated', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys(ridersMessages.en)) {
      expect(ph(get(ridersMessages.te, k)), k).toBe(ph(get(ridersMessages.en, k)));
    }
    const telugu = keys(ridersMessages.te).filter((k) => /[ఀ-౿]/.test(get(ridersMessages.te, k)));
    expect(telugu.length / keys(ridersMessages.te).length).toBeGreaterThan(0.75);
  });
});
