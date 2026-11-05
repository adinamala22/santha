import { describe, expect, it } from 'vitest';
import { everyDay } from '../../../common/hours';
import { checklist, type KycLike, type MerchantRecord, missingSteps, needsFssai, profileEditable } from './merchant';

const base: MerchantRecord = {
  id: 'm1',
  ownerUserId: 'u1',
  microMarketId: 'mm1',
  type: 'retail',
  sellsFood: false,
  category: 'stationery',
  name: 'Ramesh Stores',
  nameTe: null,
  description: null,
  addressLine: '12 Trunk Road',
  landmark: null,
  pincode: '524001',
  location: { lat: 14.45, lng: 79.99 },
  radiusM: 5000,
  deliversAnywhere: false,
  hours: everyDay('08:00', '21:00'),
  movPaise: 0,
  packagingFeePaise: 0,
  defaultFulfilment: 'self',
  returnPolicy: null,
  hygieneDeclaredAt: null,
  status: 'draft',
  submittedAt: null,
  decidedAt: null,
  decidedBy: null,
  rejectionCode: null,
  rejectionNote: null,
  liveAt: null,
  acceptingOrders: true,
  pausedReason: null,
  openUntil: null,
  slug: null,
  pausedAt: null,
  missedInARow: 0,
  photoIds: ["media-1"],
  createdAt: new Date(),
  updatedAt: new Date(),
};
const ok = (...kinds: string[]): KycLike[] => kinds.map((kind) => ({ kind, status: 'verified' }));
const core = ok('pan', 'aadhaar', 'gst_exemption', 'bank');

describe('merchant onboarding checklist', () => {
  it('non-food retail needs PAN, Aadhaar, GST (or exemption), bank, location and hours', () => {
    expect(missingSteps(checklist(base, core))).toEqual([]);
    expect(missingSteps(checklist(base, ok('pan', 'aadhaar', 'bank')))).toEqual(['gst']);
    expect(missingSteps(checklist({ ...base, microMarketId: null }, core))).toEqual(['location']);
    expect(checklist(base, core).map((i) => i.key)).not.toContain('fssai');
  });

  it('FSSAI is mandatory for every food seller', () => {
    expect(needsFssai({ type: 'home_kitchen', sellsFood: false })).toBe(true);
    expect(needsFssai({ type: 'retail', sellsFood: true })).toBe(true);
    expect(needsFssai({ type: 'fashion', sellsFood: false })).toBe(false);
    const kirana = { ...base, category: 'kirana', sellsFood: true };
    expect(missingSteps(checklist(kirana, core))).toEqual(['fssai']);
    expect(missingSteps(checklist(kirana, [...core, { kind: 'fssai', status: 'failed' }]))).toEqual(['fssai']);
    expect(missingSteps(checklist(kirana, [...core, ...ok('fssai')]))).toEqual([]);
  });

  it('type-specific steps: pharmacy drug licence, home-kitchen hygiene, fashion return policy', () => {
    expect(missingSteps(checklist({ ...base, category: 'pharmacy' }, core))).toEqual(['drug_licence']);
    expect(missingSteps(checklist({ ...base, category: 'pharmacy' }, [...core, { kind: 'drug_licence', status: 'pending' }]))).toEqual([]);
    const kitchen = { ...base, type: 'home_kitchen' as const, category: null, sellsFood: true };
    expect(missingSteps(checklist(kitchen, [...core, ...ok('fssai')]))).toEqual(['hygiene']);
    expect(missingSteps(checklist({ ...kitchen, hygieneDeclaredAt: new Date() }, [...core, ...ok('fssai')]))).toEqual([]);
    expect(missingSteps(checklist({ ...base, type: 'fashion', category: null }, core))).toEqual(['return_policy']);
  });

  it('profile is editable only before submission or after rejection', () => {
    expect(['draft', 'rejected'].every((s) => profileEditable(s as MerchantRecord['status']))).toBe(true);
    expect(['submitted', 'approved', 'live'].some((s) => profileEditable(s as MerchantRecord['status']))).toBe(false);
  });
});
