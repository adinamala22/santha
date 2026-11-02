import { describe, expect, it } from 'vitest';
import { launchMessages } from './launch';

const keys = (o: unknown, p = ''): string[] =>
  typeof o === 'string' ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, `${p}.${k}`));
const get = (root: object, k: string) => k.split('.').filter(Boolean).reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], root) as string;

describe('launch console copy', () => {
  it('has a Telugu string for every English string', () => {
    expect(keys(launchMessages.te).sort()).toEqual(keys(launchMessages.en).sort());
  });

  it('keeps placeholders identical across languages, and Telugu is actually translated', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys(launchMessages.en)) {
      expect(ph(get(launchMessages.te, k)), k).toBe(ph(get(launchMessages.en, k)));
    }
    const telugu = keys(launchMessages.te).filter((k) => /[ఀ-౿]/.test(get(launchMessages.te, k)));
    expect(telugu.length / keys(launchMessages.te).length).toBeGreaterThan(0.8);
  });
});
