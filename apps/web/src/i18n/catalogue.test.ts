import { describe, expect, it } from 'vitest';
import { catalogueMessages } from './catalogue';

const keys = (o: unknown, p = ''): string[] =>
  typeof o === 'string' ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, `${p}.${k}`));
const get = (root: object, k: string) => k.split('.').filter(Boolean).reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], root) as string;

describe('catalogue console copy', () => {
  it('has a Telugu string for every English string', () => {
    expect(keys(catalogueMessages.te).sort()).toEqual(keys(catalogueMessages.en).sort());
  });

  it('keeps placeholders identical across languages, and Telugu is actually translated', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys(catalogueMessages.en)) {
      expect(ph(get(catalogueMessages.te, k)), k).toBe(ph(get(catalogueMessages.en, k)));
    }
    const telugu = keys(catalogueMessages.te).filter((k) => /[ఀ-౿]/.test(get(catalogueMessages.te, k)));
    expect(telugu.length / keys(catalogueMessages.te).length).toBeGreaterThan(0.85);
  });
});
