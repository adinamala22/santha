import type { Role } from '@prisma/client';
import { type GeoPolygon, rect } from '../common/geo/polygon';

/**
 * Demo people shared by the Postgres seed (`prisma/seed.ts`) and the in-memory fake store
 * (`DATA_STORE=memory`), so both modes have the same sign-in numbers.
 * All numbers are in the +91 90000 00xxx test range; with MOCK_OTP_CODE=123456 any of them logs in.
 */
export interface SeedPerson {
  /** Fixed id so other seeded rows (merchants, KYC) can reference the person in both modes. */
  id: string;
  phone: string;
  name: string;
  roles: Role[];
  /** Ops console accounts only (email + password, then OTP to the phone). */
  email?: string;
}

/** Deterministic demo id from the phone's last four digits, e.g. +919000000201 → …-000000000201. */
export const seedUserId = (phone: string) => `00000000-0000-4000-8000-00000000${phone.slice(-4)}`;

const person = (phone: string, name: string, roles: Role[], email?: string): SeedPerson => ({
  id: seedUserId(phone),
  phone,
  name,
  roles,
  ...(email ? { email } : {}),
});

export const SEED_PEOPLE: readonly SeedPerson[] = [
  person('+919000000001', 'Test Consumer One', ['consumer']),
  person('+919000000002', 'Test Consumer Two', ['consumer']),
  ...[1, 2, 3].map((i) => person(`+91900000010${i}`, `Demo Rider ${i}`, ['rider'])),
  ...Array.from({ length: 12 }, (_, i) => person(`+919000000${(201 + i).toString()}`, `Demo Merchant Owner ${i + 1}`, ['merchant'])),
  person('+919000000900', 'Ops Admin', ['admin', 'ops'], 'admin@santha.local'),
];

/**
 * Password for seeded ops accounts. DEV-ONLY demo credential for local/fake mode — the seed
 * refuses to run outside APP_ENV=dev, and real ops accounts are created through the runbook.
 */
export const SEED_OPS_PASSWORD = process.env.SEED_OPS_PASSWORD ?? 'santha-admin-dev';

// ───────────── M1: city and micro-markets ─────────────

export const SEED_CITY = { slug: 'nellore', name: 'Nellore', nameTe: 'నెల్లూరు', state: 'Andhra Pradesh' } as const;

/** Version 1 of every seeded micro-market starts here (well in the past, so it is in force). */
export const SEED_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00+05:30');

export interface SeedMicroMarket {
  slug: string;
  name: string;
  nameTe: string;
  polygon: GeoPolygon;
  /** A point well inside the polygon, used by demo merchants and tests. */
  centre: { lat: number; lng: number };
}

/**
 * The four candidate pilot wards (PRD 4.6). APPROXIMATE rectangles around each area so they do
 * not overlap; ops replace them with drawn polygons from the console (each edit is a new version).
 */
export const SEED_MICRO_MARKETS: readonly SeedMicroMarket[] = [
  { slug: 'magunta-layout', name: 'Magunta Layout', nameTe: 'మాగుంట లేఅవుట్', polygon: rect(79.965, 14.445, 79.985, 14.46), centre: { lat: 14.4525, lng: 79.975 } },
  { slug: 'dargamitta', name: 'Dargamitta', nameTe: 'దర్గామిట్ట', polygon: rect(79.985, 14.445, 80.005, 14.46), centre: { lat: 14.4525, lng: 79.995 } },
  { slug: 'balaji-nagar', name: 'Balaji Nagar', nameTe: 'బాలాజీ నగర్', polygon: rect(79.985, 14.425, 80.005, 14.445), centre: { lat: 14.435, lng: 79.995 } },
  { slug: 'vedayapalem', name: 'Vedayapalem', nameTe: 'వేదాయపాలెం', polygon: rect(79.955, 14.405, 79.975, 14.425), centre: { lat: 14.415, lng: 79.965 } },
];

/** A point in Nellore outside every seeded micro-market (for "not serviceable" demos and tests). */
export const SEED_OUTSIDE_POINT = { lat: 14.48, lng: 79.94 } as const;

// ───────────── M1: demo merchants (owners +919000000201 … 212) ─────────────

export type SeedKycKind = 'pan' | 'aadhaar' | 'gstin' | 'gst_exemption' | 'fssai' | 'bank' | 'drug_licence';

export interface SeedMerchant {
  id: string;
  ownerPhone: string;
  microMarketSlug: string;
  type: 'retail' | 'fashion' | 'home_business' | 'home_kitchen';
  sellsFood: boolean;
  category: string | null;
  name: string;
  nameTe: string;
  description: string;
  addressLine: string;
  /** Offset from the micro-market centre, in degrees (keeps every store inside its polygon). */
  offset: { lat: number; lng: number };
  defaultFulfilment: 'self' | 'rider';
  radiusM: number;
  movPaise: number;
  hours: { open: string; close: string };
  status: 'draft' | 'submitted' | 'live';
  /** Verified KYC checks to seed (a draft has only some). */
  kyc: SeedKycKind[];
  returnPolicy?: string;
  staff?: Array<{ name: string; phone: string }>;
}

const mid = (n: number) => `10000000-0000-4000-8000-000000000${n}`;
const FULL: SeedKycKind[] = ['pan', 'aadhaar', 'gst_exemption', 'bank'];

export const SEED_MERCHANTS: readonly SeedMerchant[] = [
  {
    id: mid(201), ownerPhone: '+919000000201', microMarketSlug: 'dargamitta', type: 'retail', sellsFood: true, category: 'kirana',
    name: 'Ramesh Stores', nameTe: 'రమేష్ స్టోర్స్', description: 'Groceries, staples and daily needs since 1998.',
    addressLine: '14-2-31, Dargamitta Main Road', offset: { lat: 0.002, lng: -0.003 }, defaultFulfilment: 'self', radiusM: 3000,
    movPaise: 9900, hours: { open: '07:00', close: '22:00' }, status: 'live', kyc: ['pan', 'aadhaar', 'gstin', 'fssai', 'bank'],
    staff: [{ name: 'Suresh', phone: '+919000001201' }],
  },
  {
    id: mid(202), ownerPhone: '+919000000202', microMarketSlug: 'magunta-layout', type: 'retail', sellsFood: true, category: 'supermarket',
    name: 'Sri Lakshmi Supermarket', nameTe: 'శ్రీ లక్ష్మి సూపర్ మార్కెట్', description: 'Everything for the home under one roof.',
    addressLine: '3-110, Magunta Layout Cross Road', offset: { lat: -0.002, lng: 0.002 }, defaultFulfilment: 'rider', radiusM: 4000,
    movPaise: 14900, hours: { open: '08:00', close: '22:30' }, status: 'live', kyc: ['pan', 'aadhaar', 'gstin', 'fssai', 'bank'],
  },
  {
    id: mid(203), ownerPhone: '+919000000203', microMarketSlug: 'balaji-nagar', type: 'retail', sellsFood: true, category: 'fruits_vegetables',
    name: 'Balaji Fruits & Vegetables', nameTe: 'బాలాజీ ఫ్రూట్స్ & వెజిటబుల్స్', description: 'Fresh from the Nellore market every morning.',
    addressLine: '7-45, Balaji Nagar 2nd Street', offset: { lat: 0.003, lng: 0.001 }, defaultFulfilment: 'self', radiusM: 2500,
    movPaise: 4900, hours: { open: '06:00', close: '21:00' }, status: 'live', kyc: [...FULL, 'fssai'],
    staff: [{ name: 'Venkat', phone: '+919000001203' }],
  },
  {
    id: mid(204), ownerPhone: '+919000000204', microMarketSlug: 'vedayapalem', type: 'retail', sellsFood: false, category: 'pharmacy',
    name: 'Vedayapalem Medicals', nameTe: 'వేదాయపాలెం మెడికల్స్', description: 'Medicines and wellness essentials (no Schedule H/X on Santha).',
    addressLine: '2-18, Vedayapalem Centre', offset: { lat: -0.001, lng: -0.002 }, defaultFulfilment: 'rider', radiusM: 3000,
    movPaise: 0, hours: { open: '08:00', close: '23:00' }, status: 'live', kyc: ['pan', 'aadhaar', 'gstin', 'bank', 'drug_licence'],
  },
  {
    id: mid(205), ownerPhone: '+919000000205', microMarketSlug: 'magunta-layout', type: 'fashion', sellsFood: false, category: null,
    name: 'Kavya Boutique', nameTe: 'కావ్య బొటిక్', description: 'Handloom sarees, kurtis and festive wear.',
    addressLine: '5-67, Magunta Layout Main Road', offset: { lat: 0.003, lng: -0.004 }, defaultFulfilment: 'rider', radiusM: 5000,
    movPaise: 0, hours: { open: '10:00', close: '21:00' }, status: 'live', kyc: FULL,
    returnPolicy: 'Unworn items with tags can be returned within 48 hours of delivery.',
  },
  {
    id: mid(206), ownerPhone: '+919000000206', microMarketSlug: 'dargamitta', type: 'fashion', sellsFood: false, category: null,
    name: 'Nellore Footwear', nameTe: 'నెల్లూరు ఫుట్‌వేర్', description: 'Chappals, school shoes and sandals for the whole family.',
    addressLine: '16-9, Dargamitta Bazaar', offset: { lat: -0.003, lng: 0.004 }, defaultFulfilment: 'self', radiusM: 4000,
    movPaise: 0, hours: { open: '10:00', close: '21:30' }, status: 'submitted', kyc: FULL,
    returnPolicy: 'Size exchange within 48 hours if unused, original box required.',
  },
  {
    id: mid(207), ownerPhone: '+919000000207', microMarketSlug: 'balaji-nagar', type: 'home_business', sellsFood: true, category: null,
    name: "Amma's Pickles", nameTe: 'అమ్మ పచ్చళ్ళు', description: 'Avakaya, gongura and lemon pickles made at home in small batches.',
    addressLine: '9-12, Balaji Nagar 4th Cross', offset: { lat: -0.004, lng: -0.003 }, defaultFulfilment: 'rider', radiusM: 6000,
    movPaise: 19900, hours: { open: '09:00', close: '19:00' }, status: 'live', kyc: [...FULL, 'fssai'],
  },
  {
    id: mid(208), ownerPhone: '+919000000208', microMarketSlug: 'vedayapalem', type: 'home_business', sellsFood: false, category: null,
    name: 'Crafts by Divya', nameTe: 'దివ్య క్రాఫ్ట్స్', description: 'Hand-painted diyas, torans and return gifts.',
    addressLine: '4-80, Vedayapalem Colony', offset: { lat: 0.004, lng: 0.003 }, defaultFulfilment: 'rider', radiusM: 6000,
    movPaise: 0, hours: { open: '10:00', close: '20:00' }, status: 'live', kyc: FULL,
  },
  {
    id: mid(209), ownerPhone: '+919000000209', microMarketSlug: 'magunta-layout', type: 'home_business', sellsFood: true, category: null,
    name: 'Sweet Crumbs Home Bakery', nameTe: 'స్వీట్ క్రంబ్స్ హోమ్ బేకరీ', description: 'Eggless cakes and cookies baked to order.',
    addressLine: '6-22, Magunta Layout 3rd Line', offset: { lat: -0.004, lng: -0.005 }, defaultFulfilment: 'rider', radiusM: 5000,
    movPaise: 29900, hours: { open: '10:00', close: '20:00' }, status: 'submitted', kyc: [...FULL, 'fssai'],
  },
  {
    id: mid(210), ownerPhone: '+919000000210', microMarketSlug: 'dargamitta', type: 'home_kitchen', sellsFood: true, category: null,
    name: "Saraswathi's Kitchen", nameTe: 'సరస్వతి కిచెన్', description: 'Nellore chepala pulusu, pappu and daily meals.',
    addressLine: '12-4, Dargamitta Temple Street', offset: { lat: 0.005, lng: 0.006 }, defaultFulfilment: 'rider', radiusM: 4000,
    movPaise: 14900, hours: { open: '11:00', close: '21:00' }, status: 'live', kyc: [...FULL, 'fssai'],
  },
  {
    id: mid(211), ownerPhone: '+919000000211', microMarketSlug: 'balaji-nagar', type: 'home_kitchen', sellsFood: true, category: null,
    name: 'Annapurna Tiffins', nameTe: 'అన్నపూర్ణ టిఫిన్స్', description: 'Idli, dosa and pesarattu from 6 am.',
    addressLine: '8-30, Balaji Nagar 1st Street', offset: { lat: 0.001, lng: -0.006 }, defaultFulfilment: 'rider', radiusM: 3000,
    movPaise: 9900, hours: { open: '06:00', close: '11:00' }, status: 'submitted', kyc: [...FULL, 'fssai'],
  },
  {
    id: mid(212), ownerPhone: '+919000000212', microMarketSlug: 'vedayapalem', type: 'home_kitchen', sellsFood: true, category: null,
    name: 'Ruchi Home Meals', nameTe: 'రుచి హోమ్ మీల్స్', description: 'Andhra meals with a weekly menu.',
    addressLine: '3-55, Vedayapalem Main Road', offset: { lat: -0.005, lng: 0.005 }, defaultFulfilment: 'rider', radiusM: 4000,
    movPaise: 14900, hours: { open: '11:00', close: '15:00' }, status: 'draft', kyc: ['pan'],
  },
];

/** Demo KYC values for seeded merchants (numbers pass format checks; PAN/Aadhaar/bank stored masked only). */
export const seedKycValues = (n: number) => ({
  panMasked: `AB******${String(n).slice(-1)}K`,
  aadhaarMasked: `XXXX XXXX ${String(4000 + n).slice(-4)}`,
  bankMasked: `•••• ${String(7000 + n).slice(-4)}`,
  ifsc: 'SBIN0001234',
  gstin: '37AABCR1234K1Z',
  fssai: `1${String(20190000000000 + n).slice(-13)}`,
  drugLicence: `AP/NLR/20B/${10000 + n}`,
});

/** Fixed id of a seeded merchant's store photo (media row), e.g. owner …201 → …-000000000201. */
export const seedStorePhotoId = (n: number) => `30000000-0000-4000-8000-000000000${n}`;

// ───────────── M3: consumer addresses ─────────────

export interface SeedAddress {
  id: string;
  ownerPhone: string;
  label: 'home' | 'work' | 'other';
  name?: string;
  line: string;
  landmark?: string;
  pincode: string;
  microMarketSlug: string;
  /** Offset from the micro-market centre (degrees). */
  offset: { lat: number; lng: number };
  isDefault: boolean;
}

export const SEED_ADDRESSES: readonly SeedAddress[] = [
  { id: '80000000-0000-4000-8000-000000000001', ownerPhone: '+919000000001', label: 'home', line: '4-12, Sai Residency, Dargamitta 2nd Lane', landmark: 'Near Dargamitta Temple', pincode: '524003', microMarketSlug: 'dargamitta', offset: { lat: 0.001, lng: 0.001 }, isDefault: true },
  { id: '80000000-0000-4000-8000-000000000002', ownerPhone: '+919000000001', label: 'work', line: '2nd floor, Magunta Towers, Magunta Layout Main Road', pincode: '524003', microMarketSlug: 'magunta-layout', offset: { lat: 0.001, lng: -0.001 }, isDefault: false },
  { id: '80000000-0000-4000-8000-000000000003', ownerPhone: '+919000000002', label: 'home', line: '11-3, Balaji Nagar 3rd Street', landmark: 'Opposite water tank', pincode: '524002', microMarketSlug: 'balaji-nagar', offset: { lat: 0.002, lng: 0.0 }, isDefault: true },
];
