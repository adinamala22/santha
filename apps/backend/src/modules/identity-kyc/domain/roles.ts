import type { AppId, Role } from '@prisma/client';

export type { Role, AppId };
export type SignupApp = Extract<AppId, 'consumer' | 'merchant' | 'rider'>;

export const OPS_ROLES = ['admin', 'ops', 'finance', 'support'] as const satisfies readonly Role[];

/**
 * Role self-granted on first OTP login from each app. Merchant and rider roles only let the user
 * start onboarding; going live is gated by KYC + ops approval (M1). Ops roles are never self-granted.
 */
export const SIGNUP_ROLE: Record<SignupApp, Role> = {
  consumer: 'consumer',
  merchant: 'merchant',
  rider: 'rider',
};
