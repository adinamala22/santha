import { describe, expect, it } from 'vitest';
import { supportMessages } from './support';

const keys = (o: unknown, p = ''): string[] =>
  typeof o === 'string' ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, `${p}.${k}`));
const get = (root: object, k: string) => k.split('.').filter(Boolean).reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], root) as string;

describe('support chat copy', () => {
  it('has a Telugu string for every English string', () => {
    expect(keys(supportMessages.te).sort()).toEqual(keys(supportMessages.en).sort());
  });

  it('keeps placeholders identical across languages, and Telugu is actually translated', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys(supportMessages.en)) {
      expect(ph(get(supportMessages.te, k)), k).toBe(ph(get(supportMessages.en, k)));
    }
    const telugu = keys(supportMessages.te).filter((k) => /[ఀ-౿]/.test(get(supportMessages.te, k)));
    expect(telugu.length / keys(supportMessages.te).length).toBeGreaterThan(0.75);
  });
});
