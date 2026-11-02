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
