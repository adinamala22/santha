import { describe, expect, it } from 'vitest';
import { siteMessages } from './site';

const keys = (o: unknown, p = ''): string[] =>
  typeof o === 'string' ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, `${p}.${k}`));
const get = (root: object, k: string) => k.split('.').filter(Boolean).reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], root) as string;

describe('website copy', () => {
  it('has a Telugu string for every English string', () => {
    expect(keys(siteMessages.te).sort()).toEqual(keys(siteMessages.en).sort());
  });

  it('keeps placeholders identical across languages, and Telugu is actually translated', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys(siteMessages.en)) {
      expect(ph(get(siteMessages.te, k)), k).toBe(ph(get(siteMessages.en, k)));
    }
    const telugu = keys(siteMessages.te).filter((k) => /[ఀ-౿]/.test(get(siteMessages.te, k)));
    expect(telugu.length / keys(siteMessages.te).length).toBeGreaterThan(0.8);
  });
});
