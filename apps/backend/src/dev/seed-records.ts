import { everyDay } from '../common/hours';
import { merchantSlug, type MerchantRecord, type StaffRecord } from '../modules/merchant-catalogue/domain/merchant';
import { gstinCheckChar } from '../modules/identity-kyc/domain/kyc-formats';
import type { KycCheckInput } from '../modules/identity-kyc/kyc.repository';
import type { PromoRecord } from '../modules/cart-pricing/domain/promo';
import { SEED_PEOPLE, seedStorePhotoId, SEED_EFFECTIVE_FROM, SEED_MERCHANTS, SEED_MICRO_MARKETS, SEED_PROMOS, seedKycValues, seedUserId, type SeedKycKind } from './seed-data';

export interface SeedMerchantRecords {
  merchants: MerchantRecord[];
  staff: StaffRecord[];
}

const DAY = 24 * 3600 * 1000;

function kycCheck(kind: SeedKycKind, n: number, at: Date): KycCheckInput {
  const v = seedKycValues(n);
  const base = {
    kind,
    status: 'verified' as const,
    valueMasked: null as string | null,
    valuePublic: null as string | null,
    nameOnRecord: null as string | null,
    provider: 'mock',
    providerRef: `seed-${kind}-${n}`,
    failureReason: null,
    details: null as Record<string, unknown> | null,
    verifiedAt: at,
  };
  switch (kind) {
    case 'pan':
      return { ...base, valueMasked: v.panMasked, nameOnRecord: `DEMO OWNER ${n}` };
    case 'aadhaar':
      return { ...base, valueMasked: v.aadhaarMasked, nameOnRecord: `DEMO OWNER ${n}` };
    case 'gstin':
      return { ...base, valuePublic: v.gstin + gstinCheckChar(v.gstin), nameOnRecord: 'DEMO TRADERS', details: { status: 'Active' } };
    case 'gst_exemption':
      return { ...base, provider: 'self-declaration', providerRef: null, details: { reason: 'Turnover below the GST threshold' } };
    case 'fssai':
      return { ...base, valuePublic: v.fssai, nameOnRecord: 'DEMO FOOD BUSINESS', details: { kind: 'registration', validUpto: '2028-03-31' } };
    case 'bank':
      return { ...base, valueMasked: v.bankMasked, nameOnRecord: `DEMO OWNER ${n}`, details: { ifsc: v.ifsc } };
    case 'drug_licence':
      return { ...base, status: 'pending', provider: 'manual-review', providerRef: null, valuePublic: v.drugLicence, verifiedAt: null };
  }
}

/** Demo KYC checks for the seeded merchants (keyed by their fixed ids) — seeded by identity-kyc. */
export function buildSeedKyc(): Array<{ merchantId: string; check: KycCheckInput }> {
  const t0 = SEED_EFFECTIVE_FROM.getTime();
  return SEED_MERCHANTS.flatMap((s, i) => {
    const n = Number(s.ownerPhone.slice(-3));
    return s.kyc.map((k) => ({ merchantId: s.id, check: kycCheck(k, n, new Date(t0 + i * DAY)) }));
  });
}

/**
 * Builds the 12 demo merchants (SEED_MERCHANTS) as records. Used by the in-memory store at boot
 * and by `prisma/seed.ts`, so fake mode and Postgres start identical.
 */
export function buildSeedMerchants(marketIdBySlug: ReadonlyMap<string, string>): SeedMerchantRecords {
  const out: SeedMerchantRecords = { merchants: [], staff: [] };
  const t0 = SEED_EFFECTIVE_FROM.getTime();
  SEED_MERCHANTS.forEach((s, i) => {
    const n = Number(s.ownerPhone.slice(-3));
    const market = SEED_MICRO_MARKETS.find((m) => m.slug === s.microMarketSlug)!;
    const microMarketId = marketIdBySlug.get(s.microMarketSlug);
    if (!microMarketId) throw new Error(`Seed micro-market ${s.microMarketSlug} missing`);
    const created = new Date(t0 + i * DAY);
    const submitted = s.status === 'draft' ? null : new Date(t0 + (20 + i) * DAY);
    const live = s.status === 'live';
    out.merchants.push({
      id: s.id,
      ownerUserId: seedUserId(s.ownerPhone),
      microMarketId,
      type: s.type,
      sellsFood: s.sellsFood,
      category: s.category,
      name: s.name,
      nameTe: s.nameTe,
      description: s.description,
      addressLine: s.addressLine,
      landmark: null,
      pincode: '524004',
      location: { lat: market.centre.lat + s.offset.lat, lng: market.centre.lng + s.offset.lng },
      radiusM: s.radiusM,
      deliversAnywhere: false,
      hours: everyDay(s.hours.open, s.hours.close),
      movPaise: s.movPaise,
      // Kitchens and home businesses pack each order; shops include packing in the price.
      packagingFeePaise: s.type === 'home_kitchen' ? 1000 : s.type === 'home_business' ? 500 : 0,
      defaultFulfilment: s.defaultFulfilment,
      returnPolicy: s.returnPolicy ?? null,
      hygieneDeclaredAt: s.type === 'home_kitchen' && s.status !== 'draft' ? created : null,
      status: s.status,
      submittedAt: submitted,
      decidedAt: live ? new Date(t0 + (22 + i) * DAY) : null,
      decidedBy: live ? seedUserId('+919000000900') : null,
      rejectionCode: null,
      rejectionNote: null,
      liveAt: live ? new Date(t0 + (23 + i) * DAY) : null,
      acceptingOrders: true,
      pausedReason: null,
      openUntil: null,
      slug: live ? merchantSlug(s.name, s.id) : null,
      pausedAt: null,
      missedInARow: 0,
      photoIds: s.status === 'draft' ? [] : [seedStorePhotoId(n)],
      createdAt: created,
      updatedAt: created,
    });
    for (const st of s.staff ?? [])
      out.staff.push({ id: `20000000-0000-4000-8000-000000000${n}`, merchantId: s.id, name: st.name, phone: st.phone, active: true, createdAt: created });
  });
  return out;
}

/** Demo promos as stored records (fake mode and the Postgres seed share them). */
export function buildSeedPromos(): PromoRecord[] {
  return SEED_PROMOS.map((p) => ({
    ...p,
    merchantTypes: [...p.merchantTypes],
    spentPaise: 0,
    microMarketIds: [],
    merchantIds: [],
    validFrom: SEED_EFFECTIVE_FROM,
    validTo: null,
    active: true,
    createdBy: null,
    createdAt: SEED_EFFECTIVE_FROM,
    updatedAt: SEED_EFFECTIVE_FROM,
  }));
}

/** M6: rider profiles for the demo riders (offline until they go online in the rider app). */
export function buildSeedRiders(): Array<{ userId: string; name: string; vehicle: string; rating: number; status: 'approved'; vehicleNumber: string | null }> {
  // The demo riders are already onboarded and approved (ADR-029).
  return SEED_PEOPLE.filter((p) => p.roles.includes('rider')).map((p, i) => ({
    userId: p.id,
    name: p.name,
    vehicle: i === 2 ? 'cycle' : 'bike',
    rating: [4.8, 4.6, 4.9][i] ?? 4.5,
    status: 'approved' as const,
    vehicleNumber: i === 2 ? null : `AP26AB${1001 + i}`,
  }));
}
