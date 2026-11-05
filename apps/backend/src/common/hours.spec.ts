import { describe, expect, it } from 'vitest';
import { everyDay, manualOpenUntil, openStatus } from './hours';

// 2026-11-05 is a Thursday. Instants are written in IST (+05:30).
const ist = (s: string) => new Date(`${s}+05:30`);
const nineToNine = everyDay('09:00', '21:00');

describe('open outside the hours (ADR-021)', () => {
  it('after closing: open until the end of the next opening period', () => {
    expect(manualOpenUntil(nineToNine, ist('2026-11-05T22:30:00'))).toEqual(ist('2026-11-06T21:00:00'));
  });
  it('before opening: open until the close today', () => {
    expect(manualOpenUntil(nineToNine, ist('2026-11-05T07:00:00'))).toEqual(ist('2026-11-05T21:00:00'));
  });
  it('closed days are skipped', () => {
    const h = { ...nineToNine, fri: [] };
    expect(manualOpenUntil(h, ist('2026-11-05T22:00:00'))).toEqual(ist('2026-11-07T21:00:00'));
  });
  it('no hours at all: until local midnight', () => {
    expect(manualOpenUntil(null, ist('2026-11-05T22:00:00'))).toEqual(ist('2026-11-06T00:00:00'));
  });
  it('openStatus honours the override until it ends, then the hours decide again', () => {
    const until = ist('2026-11-06T21:00:00');
    expect(openStatus(nineToNine, ist('2026-11-05T22:30:00'), until)).toEqual({ open: true, nextOpenAt: null, closesAt: until });
    expect(openStatus(nineToNine, ist('2026-11-05T22:30:00'), until.getTime()).open).toBe(true);
    expect(openStatus(nineToNine, ist('2026-11-06T21:30:00'), until).open).toBe(false);
    expect(openStatus(nineToNine, ist('2026-11-05T22:30:00')).open).toBe(false);
  });
});
