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
  BARCODE_UNKNOWN: 404,
  PROVIDER_UNAVAILABLE: 503,
  /** Pre-launch production: the apps' endpoints are closed until launch (ADR-024). */
  PRELAUNCH: 503,
  // M4 — cart, checkout, orders, payments
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_MISMATCH: 422,
  IDEMPOTENCY_IN_PROGRESS: 409,
  CART_CONFLICT: 409,
  CART_EMPTY: 422,
  QUOTE_EXPIRED: 409,
  QUOTE_CHANGED: 409,
  NOT_PLACEABLE: 422,
  COD_NOT_ALLOWED: 422,
  PROMO_INVALID: 422,
  SLOT_UNAVAILABLE: 409,
  PAYMENT_SIGNATURE_INVALID: 400,
  WEBHOOK_SIGNATURE_INVALID: 401,
  // M6 — dispatch
  OFFER_EXPIRED: 409,
  WRONG_CODE: 422,
  NOT_READY: 409,
  /** ADR-029: onboarding not finished or not approved by ops (or suspended). */
  RIDER_NOT_APPROVED: 403,
  /** Going offline or signing out with a delivery in hand. */
  RIDER_HAS_ACTIVE_JOB: 409,
  // M7 — money
  FOUR_EYES_REQUIRED: 409,
  APPROVAL_LIMIT: 403,
  ISSUE_WINDOW_CLOSED: 422,
  DISPUTE_WINDOW_CLOSED: 422,
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
