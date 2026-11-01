import { DomainError } from '../../../common/errors/domain-error';

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * Normalises an Indian mobile number to E.164 (+91XXXXXXXXXX).
 * Accepts "9876543210", "09876543210", "+91 98765 43210", "91-9876543210".
 */
export function normalizeIndianMobile(input: string): string {
  let digits = input.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!INDIAN_MOBILE.test(digits)) throw new DomainError('INVALID_PHONE', 'Enter a valid 10-digit mobile number');
  return `+91${digits}`;
}
