/**
 * GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) check digits. Barcodes are stored as scanned (digits only);
 * UPC-A (12) and EAN-13 with a leading 0 are the same product, so lookups try both forms.
 */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/** Completes a GTIN body with its check digit, e.g. for generated demo barcodes. */
export const withCheckDigit = (body: string) => body + String(gtinCheckDigit(body));

/** Equivalent spellings of the same GTIN to try on lookup (UPC-A ↔ EAN-13 with leading zero). */
export function gtinAliases(code: string): string[] {
  if (code.length === 12) return [code, `0${code}`];
  if (code.length === 13 && code.startsWith('0')) return [code, code.slice(1)];
  return [code];
}
