import { describe, expect, it } from 'vitest';
import { orderMessages } from './orders';

const keys = (o: unknown, p = ''): string[] =>
  typeof o === 'string' ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, `${p}.${k}`));
const get = (root: object, k: string) => k.split('.').filter(Boolean).reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], root) as string;

describe('order console copy', () => {
  it('has a Telugu string for every English string', () => {
    expect(keys(orderMessages.te).sort()).toEqual(keys(orderMessages.en).sort());
  });

  it('keeps placeholders identical across languages, and Telugu is actually translated', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys(orderMessages.en)) {
      expect(ph(get(orderMessages.te, k)), k).toBe(ph(get(orderMessages.en, k)));
    }
    const telugu = keys(orderMessages.te).filter((k) => /[ఀ-౿]/.test(get(orderMessages.te, k)));
    expect(telugu.length / keys(orderMessages.te).length).toBeGreaterThan(0.8);
  });
});
