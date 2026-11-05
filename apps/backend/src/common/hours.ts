import { z } from 'zod';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

/**
 * One opening period. A closing time earlier than the opening time runs past midnight into the next day
 * (18:00–01:00 is open until 1 AM; 00:00 as the close means midnight). Equal times are refused.
 */
export const TimeRangeSchema = z
  .object({ open: hhmm, close: hhmm })
  .refine((r) => r.open !== r.close, { message: 'Opening and closing time must differ' });

/** True when the period ends after midnight (on the next calendar day). */
export const overnight = (r: { open: string; close: string }) => r.close < r.open;

/**
 * Weekly opening hours in local time (Asia/Kolkata). A day with an empty list is closed.
 * Ranges within a day must not overlap; only the day's last range may run past midnight.
 * Used by micro-markets and merchants.
 */
export const WeeklyHoursSchema = z
  .object(Object.fromEntries(DAYS.map((d) => [d, z.array(TimeRangeSchema).max(4)])) as Record<Day, z.ZodArray<typeof TimeRangeSchema>>)
  .superRefine((h, ctx) => {
    for (const d of DAYS) {
      const ranges = [...h[d]].sort((a, b) => a.open.localeCompare(b.open));
      for (let i = 1; i < ranges.length; i++)
        if (ranges[i]!.open < ranges[i - 1]!.close || overnight(ranges[i - 1]!))
          ctx.addIssue({ code: 'custom', path: [d], message: 'Time ranges overlap' });
    }
  });
export type WeeklyHours = z.infer<typeof WeeklyHoursSchema>;

export const everyDay = (open: string, close: string): WeeklyHours =>
  Object.fromEntries(DAYS.map((d) => [d, [{ open, close }]])) as WeeklyHours;

// ───────────── local time (Asia/Kolkata, no DST) ─────────────

const IST_OFFSET_MS = 330 * 60_000;

/** Local (Asia/Kolkata) calendar parts of an instant. */
export function istParts(at: Date): { date: string; day: Day; minutes: number; hhmm: string } {
  const t = new Date(at.getTime() + IST_OFFSET_MS);
  const iso = t.toISOString();
  return {
    date: iso.slice(0, 10),
    day: DAYS[(t.getUTCDay() + 6) % 7]!, // getUTCDay: 0 = Sunday
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
    hhmm: iso.slice(11, 16),
  };
}

/** The instant for a local date (YYYY-MM-DD) and HH:MM in Asia/Kolkata. */
export const istInstant = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

/**
 * Is a store open at `at`, and if not, when does it next open (within a week)? Closed stores are
 * listed greyed with their next-open time (FR-DIS-1).
 */
export function openStatus(
  hours: WeeklyHours | null,
  at: Date,
  /** The partner's Open switch outside the hours (ADR-021): open until this instant. */
  openUntil?: Date | number | null,
): { open: boolean; nextOpenAt: Date | null; closesAt: Date | null } {
  if (openUntil != null && at.getTime() < new Date(openUntil).getTime()) return { open: true, nextOpenAt: null, closesAt: new Date(openUntil) };
  if (!hours) return { open: false, nextOpenAt: null, closesAt: null };
  const now = istParts(at);
  const current = periods(hours, at, -1, 0).find((p) => p.start <= at.getTime() && at.getTime() < p.end);
  if (current) return { open: true, nextOpenAt: null, closesAt: new Date(current.end) };
  for (let d = 0; d < 8; d++) {
    const p = istParts(new Date(at.getTime() + d * 86_400_000));
    const next = [...hours[p.day]].sort((a, b) => a.open.localeCompare(b.open)).find((r) => d > 0 || r.open > now.hhmm);
    if (next) return { open: false, nextOpenAt: istInstant(p.date, next.open), closesAt: null };
  }
  return { open: false, nextOpenAt: null, closesAt: null };
}

/**
 * When a store the partner opens now, outside its hours, closes again (ADR-021): the next scheduled
 * close (the end of its next opening period, so it stays open straight through), or local midnight
 * when it has no hours in the coming week.
 */
export function manualOpenUntil(hours: WeeklyHours | null, at: Date): Date {
  const now = istParts(at);
  if (hours) {
    const end = periods(hours, at, -1, 7)
      .map((p) => p.end)
      .filter((e) => e > at.getTime())
      .sort((a, b) => a - b)[0];
    if (end != null) return new Date(end);
  }
  return new Date(istInstant(now.date, '00:00').getTime() + 86_400_000);
}

/** Opening periods as instants, for the local days from `from` to `to` (0 = today); overnight ones end the next day. */
function periods(hours: WeeklyHours, at: Date, from: number, to: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let d = from; d <= to; d++) {
    const p = istParts(new Date(at.getTime() + d * 86_400_000));
    for (const r of hours[p.day]) {
      const start = istInstant(p.date, r.open).getTime();
      const end = istInstant(p.date, r.close).getTime() + (overnight(r) ? 86_400_000 : 0);
      out.push({ start, end });
    }
  }
  return out;
}
