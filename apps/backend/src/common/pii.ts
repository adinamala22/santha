/** Masks an E.164 phone for logs and cross-party display: +9198******10 */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return '***';
  return `${phone.slice(0, 5)}${'*'.repeat(Math.max(0, phone.length - 7))}${phone.slice(-2)}`;
}

/** pino redact paths — anything that can carry PII or secrets. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.phone',
  'req.body.code',
  'req.body.refreshToken',
  'res.body.accessToken',
  'res.body.refreshToken',
  '*.phone',
  '*.address',
  '*.code',
  '*.refreshToken',
  '*.accessToken',
];
