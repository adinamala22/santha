import type { FulfilmentMode, MerchantStatus, MerchantType } from '@prisma/client';
import type { LatLng } from '../../../common/geo/polygon';
import type { WeeklyHours } from '../../../common/hours';

export type { FulfilmentMode, MerchantStatus, MerchantType };

export interface MerchantRecord {
  id: string;
  ownerUserId: string;
  microMarketId: string | null;
  type: MerchantType;
  sellsFood: boolean;
  category: string | null;
  name: string;
  nameTe: string | null;
  description: string | null;
  addressLine: string | null;
  landmark: string | null;
  pincode: string | null;
  location: LatLng | null;
  radiusM: number;
  hours: WeeklyHours | null;
  movPaise: number;
  /** Per-order packaging charge (paise); cart-pricing caps it at the micro-market fee rule. */
  packagingFeePaise: number;
  defaultFulfilment: FulfilmentMode;
  returnPolicy: string | null;
  hygieneDeclaredAt: Date | null;
  status: MerchantStatus;
  submittedAt: Date | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  rejectionCode: string | null;
  rejectionNote: string | null;
  liveAt: Date | null;
  /** Store toggle; false also when auto-paused after two missed orders in a row. */
  acceptingOrders: boolean;
  pausedReason: string | null;
  /** Public store link /s/{slug} (M8); set at go-live. */
  slug: string | null;
  pausedAt: Date | null;
  missedInARow: number;
  /** Store photos (media ids in display order); consumers see the approved ones. */
  photoIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffRecord {
  id: string;
  merchantId: string;
  name: string;
  phone: string;
  active: boolean;
  createdAt: Date;
}

/** Retail sub-categories (platform taxonomy, PRD 4.2). `pharmacy` additionally needs a drug licence. */
export const RETAIL_CATEGORIES = [
  'kirana',
  'supermarket',
  'pharmacy',
  'bakery',
  'meat_fish',
  'fruits_vegetables',
  'stationery',
  'electronics',
  'other',
] as const;

export const REJECTION_CODES = [
  'kyc_mismatch',
  'fssai_invalid',
  'documents_unclear',
  'outside_serviceable_area',
  'restricted_category',
  'duplicate_merchant',
  'other',
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export const MAX_STAFF = 20;

/** Profile fields lock once submitted (ops reviewed them); operational fields can change any time. */
export const PROFILE_FIELDS = [
  'type',
  'sellsFood',
  'category',
  'name',
  'nameTe',
  'description',
  'location',
  'addressLine',
  'landmark',
  'pincode',
  'returnPolicy',
  'hygieneDeclared',
] as const;
export const OPERATIONAL_FIELDS = ['hours', 'radiusM', 'movPaise', 'packagingFeePaise', 'defaultFulfilment'] as const;

export const profileEditable = (s: MerchantStatus) => s === 'draft' || s === 'rejected';

/** Food sellers need FSSAI: every home kitchen, and any other merchant that sells food. */
export const needsFssai = (m: Pick<MerchantRecord, 'type' | 'sellsFood'>) => m.type === 'home_kitchen' || m.sellsFood;

export type ChecklistKey =
  | 'business'
  | 'location'
  | 'hours'
  | 'photos'
  | 'pan'
  | 'aadhaar'
  | 'gst'
  | 'fssai'
  | 'drug_licence'
  | 'bank'
  | 'hygiene'
  | 'return_policy';

export interface ChecklistItem {
  key: ChecklistKey;
  done: boolean;
}

export interface KycLike {
  kind: string;
  status: 'pending' | 'verified' | 'failed';
}

/**
 * The onboarding steps a merchant must complete before submitting (PRD 9.4, FR-TRS-1/2), in the
 * order the app shows them. Only the items that apply to this merchant are returned.
 */
export function checklist(m: MerchantRecord, kyc: KycLike[]): ChecklistItem[] {
  const verified = (k: string) => kyc.some((c) => c.kind === k && c.status === 'verified');
  const items: ChecklistItem[] = [
    { key: 'business', done: m.name.trim().length >= 2 },
    { key: 'location', done: !!m.location && !!m.microMarketId && !!m.addressLine },
    { key: 'hours', done: !!m.hours && Object.values(m.hours).some((d) => d.length > 0) },
    { key: 'photos', done: m.photoIds.length > 0 },
    { key: 'pan', done: verified('pan') },
    { key: 'aadhaar', done: verified('aadhaar') },
    { key: 'gst', done: verified('gstin') || verified('gst_exemption') },
  ];
  if (needsFssai(m)) items.push({ key: 'fssai', done: verified('fssai') });
  if (m.category === 'pharmacy') items.push({ key: 'drug_licence', done: kyc.some((c) => c.kind === 'drug_licence' && c.status !== 'failed') });
  items.push({ key: 'bank', done: verified('bank') });
  if (m.type === 'home_kitchen') items.push({ key: 'hygiene', done: !!m.hygieneDeclaredAt });
  if (m.type === 'fashion') items.push({ key: 'return_policy', done: !!m.returnPolicy && m.returnPolicy.trim().length >= 10 });
  return items;
}

export const missingSteps = (items: ChecklistItem[]) => items.filter((i) => !i.done).map((i) => i.key);

/** URL slug for the public store page: lower-case words of the name + 4 characters of the id. */
export function merchantSlug(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'store'}-${id.replace(/-/g, '').slice(-4)}`;
}
