/** Formatting for the console. Money is integer paise everywhere; dates are shown in IST. */
const TZ = 'Asia/Kolkata';

export const rupees = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 === 0 ? 0 : 2 }).format(paise / 100);

/** Rupee value for an input field (e.g. 99.5), and back to paise. */
export const paiseToRupeeInput = (paise: number) => String(paise / 100);
export const rupeeInputToPaise = (value: string) => Math.round(Number(value) * 100);

export const dateTime = (iso: string | null | undefined, locale: 'en' | 'te' = 'en') =>
  iso
    ? new Intl.DateTimeFormat(locale === 'te' ? 'te-IN' : 'en-IN', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
    : '—';

export const dateOnly = (iso: string | null | undefined, locale: 'en' | 'te' = 'en') =>
  iso ? new Intl.DateTimeFormat(locale === 'te' ? 'te-IN' : 'en-IN', { timeZone: TZ, dateStyle: 'medium' }).format(new Date(iso)) : '—';

export const km = (metres: number) => `${(metres / 1000).toFixed(metres % 1000 === 0 ? 0 : 1)} km`;

/** Value for <input type="datetime-local"> in IST, and back to an ISO instant. */
export function toLocalInput(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600_000);
  return d.toISOString().slice(0, 16);
}
export function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}:00+05:30`).toISOString();
}
