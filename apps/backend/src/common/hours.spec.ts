import { describe, expect, it } from 'vitest';
import { WeeklyHoursSchema, everyDay, manualOpenUntil, openStatus } from './hours';

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

describe('hours past midnight', () => {
  const lateNight = everyDay('18:00', '01:00');

  it('a closing time before the opening time runs into the next day', () => {
    expect(WeeklyHoursSchema.safeParse(lateNight).success).toBe(true);
    expect(WeeklyHoursSchema.safeParse(everyDay('18:00', '00:00')).success).toBe(true);
    expect(WeeklyHoursSchema.safeParse(everyDay('09:00', '09:00')).success).toBe(false);
  });
  it('only the last range of a day may run past midnight', () => {
    const h = { ...everyDay('09:00', '13:00'), mon: [{ open: '09:00', close: '02:00' }, { open: '17:00', close: '22:00' }] };
    expect(WeeklyHoursSchema.safeParse(h).success).toBe(false);
  });
  it('open in the evening and after midnight, closed in between', () => {
    expect(openStatus(lateNight, ist('2026-11-05T19:00:00'))).toEqual({ open: true, nextOpenAt: null, closesAt: ist('2026-11-06T01:00:00') });
    expect(openStatus(lateNight, ist('2026-11-06T00:30:00'))).toEqual({ open: true, nextOpenAt: null, closesAt: ist('2026-11-06T01:00:00') });
    expect(openStatus(lateNight, ist('2026-11-06T02:00:00'))).toEqual({ open: false, nextOpenAt: ist('2026-11-06T18:00:00'), closesAt: null });
  });
  it('after midnight it is open only if the day before ran late', () => {
    const h = { ...lateNight, wed: [] }; // closed Wednesday: nothing carries into Thursday morning
    expect(openStatus(h, ist('2026-11-05T00:30:00')).open).toBe(false);
  });
  it('midnight as the close', () => {
    expect(openStatus(everyDay('18:00', '00:00'), ist('2026-11-05T23:59:00')).closesAt).toEqual(ist('2026-11-06T00:00:00'));
  });
  it('the Open switch outside late hours stays open until the next close', () => {
    expect(manualOpenUntil(lateNight, ist('2026-11-05T10:00:00'))).toEqual(ist('2026-11-06T01:00:00'));
    expect(manualOpenUntil(lateNight, ist('2026-11-06T00:30:00'))).toEqual(ist('2026-11-06T01:00:00'));
  });
});
