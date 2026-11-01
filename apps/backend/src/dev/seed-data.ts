import type { Role } from '@prisma/client';

/**
 * Demo people shared by the Postgres seed (`prisma/seed.ts`) and the in-memory fake store
 * (`DATA_STORE=memory`), so both modes have the same sign-in numbers.
 * All numbers are in the +91 90000 00xxx test range; with MOCK_OTP_CODE=123456 any of them logs in.
 */
export interface SeedPerson {
  phone: string;
  name: string;
  roles: Role[];
}

export const SEED_PEOPLE: readonly SeedPerson[] = [
  { phone: '+919000000001', name: 'Test Consumer One', roles: ['consumer'] },
  { phone: '+919000000002', name: 'Test Consumer Two', roles: ['consumer'] },
  ...[1, 2, 3].map((i) => ({ phone: `+91900000010${i}`, name: `Demo Rider ${i}`, roles: ['rider'] as Role[] })),
  ...Array.from({ length: 12 }, (_, i) => ({
    phone: `+919000000${(201 + i).toString()}`,
    name: `Demo Merchant Owner ${i + 1}`,
    roles: ['merchant'] as Role[],
  })),
  { phone: '+919000000900', name: 'Ops Admin', roles: ['admin', 'ops'] },
];
