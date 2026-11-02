import { z } from 'zod';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

export const TimeRangeSchema = z
  .object({ open: hhmm, close: hhmm })
  .refine((r) => r.open < r.close, { message: 'Closing time must be after opening time' });

/**
 * Weekly opening hours in local time (Asia/Kolkata). A day with an empty list is closed.
 * Ranges within a day must not overlap. Used by micro-markets and merchants.
 */
export const WeeklyHoursSchema = z
  .object(Object.fromEntries(DAYS.map((d) => [d, z.array(TimeRangeSchema).max(4)])) as Record<Day, z.ZodArray<typeof TimeRangeSchema>>)
  .superRefine((h, ctx) => {
    for (const d of DAYS) {
      const ranges = [...h[d]].sort((a, b) => a.open.localeCompare(b.open));
      for (let i = 1; i < ranges.length; i++)
        if (ranges[i]!.open < ranges[i - 1]!.close)
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
export function openStatus(hours: WeeklyHours | null, at: Date): { open: boolean; nextOpenAt: Date | null; closesAt: Date | null } {
  if (!hours) return { open: false, nextOpenAt: null, closesAt: null };
  const now = istParts(at);
  const today = [...hours[now.day]].sort((a, b) => a.open.localeCompare(b.open));
  const current = today.find((r) => r.open <= now.hhmm && now.hhmm < r.close);
  if (current) return { open: true, nextOpenAt: null, closesAt: istInstant(now.date, current.close) };
  for (let d = 0; d < 8; d++) {
    const p = istParts(new Date(at.getTime() + d * 86_400_000));
    const next = [...hours[p.day]].sort((a, b) => a.open.localeCompare(b.open)).find((r) => d > 0 || r.open > now.hhmm);
    if (next) return { open: false, nextOpenAt: istInstant(p.date, next.open), closesAt: null };
  }
  return { open: false, nextOpenAt: null, closesAt: null };
}
