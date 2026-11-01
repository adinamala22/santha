/**
 * Format and checksum validation for Indian KYC identifiers. These run before any provider call,
 * so typos are caught instantly and cost nothing. Passing format checks does NOT mean verified —
 * only the KYC provider (or ops, for drug licences) can verify.
 */

/** PAN: 5 letters, 4 digits, 1 letter; the 4th letter is the holder type (P = individual, F = firm, …). */
export const PAN_RE = /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/;
export const isPan = (v: string) => PAN_RE.test(v);

// Verhoeff tables (Aadhaar's check digit).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffValid(num: string): boolean {
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c]![P[i % 8]![digits[i]!]!]!;
  return c === 0;
}

export function verhoeffCheckDigit(num: string): string {
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c]![P[(i + 1) % 8]![digits[i]!]!]!;
  return String(INV[c]);
}

/** Aadhaar: 12 digits, cannot start with 0 or 1, Verhoeff checksum. */
export const isAadhaar = (v: string) => /^[2-9]\d{11}$/.test(v) && verhoeffValid(v);

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const prod = GST_CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36]!;
}

/** GSTIN: 2-digit state code (01–38, 97, 99), the holder's PAN, entity number, 'Z', check character. */
export function isGstin(v: string): boolean {
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v)) return false;
  const state = Number(v.slice(0, 2));
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) return false;
  return gstinCheckChar(v.slice(0, 14)) === v[14];
}

/** PAN embedded in a GSTIN (characters 3–12). */
export const panOfGstin = (gstin: string) => gstin.slice(2, 12);

/** FSSAI licence/registration number: 14 digits, first digit 1 (licence) or 2 (registration). */
export const isFssai = (v: string) => /^[12]\d{13}$/.test(v);

/** IFSC: 4-letter bank code, 0, 6-character branch code. */
export const isIfsc = (v: string) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v);

/** Indian bank account numbers are 9–18 digits. */
export const isBankAccount = (v: string) => /^\d{9,18}$/.test(v);

/** Drug licence numbers vary by state (e.g. AP/NLR/20B/12345); captured for ops review. */
export const isDrugLicence = (v: string) => /^[A-Z0-9][A-Z0-9/ -]{4,39}$/.test(v);

// ── masking (PAN, Aadhaar and account numbers are never stored in full) ──
export const maskPan = (v: string) => `${v.slice(0, 2)}${'*'.repeat(6)}${v.slice(-2)}`;
export const maskAadhaar = (v: string) => `XXXX XXXX ${v.slice(-4)}`;
export const maskAccount = (v: string) => `${'•'.repeat(4)} ${v.slice(-4)}`;
