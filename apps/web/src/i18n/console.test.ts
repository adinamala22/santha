import { describe, expect, it } from 'vitest';
import { consoleMessages, errorText, fill } from './console';

const keys = (o: unknown, p = ''): string[] =>
  typeof o === 'string' ? [p] : Object.entries(o as object).flatMap(([k, v]) => keys(v, `${p}.${k}`));

describe('console copy', () => {
  it('has a Telugu string for every English string', () => {
    expect(keys(consoleMessages.te).sort()).toEqual(keys(consoleMessages.en).sort());
  });

  it('keeps placeholders identical across languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    const en = new Map(keys(consoleMessages.en).map((k) => [k, k]));
    for (const k of en.keys()) {
      const get = (root: object) => k.split('.').filter(Boolean).reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], root) as string;
      expect(ph(get(consoleMessages.te)), k).toBe(ph(get(consoleMessages.en)));
    }
  });

  it('fills placeholders and maps error codes with a fallback', () => {
    expect(fill('{n} waiting · {f} food', { n: 3, f: 1 })).toBe('3 waiting · 1 food');
    expect(fill('{n} {n|item|items}', { n: 1 })).toBe('1 item');
    expect(fill('{n} {n|item|items}', { n: 2 })).toBe('2 items');
    expect(errorText(consoleMessages.te, 'POLYGON_OVERLAP')).toBe(consoleMessages.te.errors.POLYGON_OVERLAP);
    expect(errorText(consoleMessages.en, 'SOMETHING_NEW')).toBe(consoleMessages.en.errors.UNKNOWN);
  });
});
