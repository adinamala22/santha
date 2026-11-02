import { describe, expect, it } from 'vitest';
import { moneyMessages } from './money';

const keys = (o: unknown, p = ''): string[] =>
  typeof o === 'string' ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, `${p}.${k}`));
const get = (root: object, k: string) => k.split('.').filter(Boolean).reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], root) as string;

describe('money console copy', () => {
  it('has a Telugu string for every English string', () => {
    expect(keys(moneyMessages.te).sort()).toEqual(keys(moneyMessages.en).sort());
  });

  it('keeps placeholders identical across languages, and Telugu is actually translated', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys(moneyMessages.en)) {
      expect(ph(get(moneyMessages.te, k)), k).toBe(ph(get(moneyMessages.en, k)));
    }
    const telugu = keys(moneyMessages.te).filter((k) => /[ఀ-౿]/.test(get(moneyMessages.te, k)));
    expect(telugu.length / keys(moneyMessages.te).length).toBeGreaterThan(0.8);
  });
});
