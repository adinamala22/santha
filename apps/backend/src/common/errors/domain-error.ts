/**
 * Typed domain error. Services throw these; the global filter maps `code` → HTTP status.
 * Never put provider error text in `message` — it is shown to clients.
 */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  INVALID_PHONE: 400,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_TOO_MANY_ATTEMPTS: 429,
  RATE_LIMITED: 429,
  CHECKLIST_INCOMPLETE: 422,
  KYC_FAILED: 422,
  NOT_SERVICEABLE: 422,
  POLYGON_INVALID: 422,
  POLYGON_OVERLAP: 409,
  VERSION_CONFLICT: 409,
  ALREADY_EXISTS: 409,
  INVALID_STATE: 409,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  REFRESH_INVALID: 401,
  DEVICE_MISMATCH: 401,
  FORBIDDEN: 403,
  ACCOUNT_BLOCKED: 403,
  NOT_FOUND: 404,
  PROVIDER_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}
