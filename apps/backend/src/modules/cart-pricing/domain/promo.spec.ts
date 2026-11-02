import { describe, expect, it } from 'vitest';
import { evaluatePromo, normaliseCode, type PromoContext, type PromoRecord, rawDiscount } from './promo';

const now = new Date('2026-11-05T06:00:00Z');
const promo = (over: Partial<PromoRecord> = {}): PromoRecord => ({
  id: 'p1',
  code: 'NELLORE50',
  description: '₹50 off',
  descriptionTe: '₹50 తగ్గింపు',
  kind: 'flat',
  value: 5000,
  maxDiscountPaise: null,
  minOrderPaise: 19900,
  budgetPaise: 100_000,
  spentPaise: 0,
  perUserLimit: 1,
  firstOrderOnly: false,
  merchantSharePercent: 0,
  microMarketIds: [],
  merchantTypes: [],
  merchantIds: [],
  validFrom: new Date('2026-11-01T00:00:00Z'),
  validTo: null,
  active: true,
  createdBy: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});
const ctx = (over: Partial<PromoContext> = {}): PromoContext => ({
  itemsPaise: 25000,
  merchant: { id: 'm1', type: 'retail', microMarketId: 'mm1' },
  userRedemptions: 0,
  userPlacedOrders: 0,
  now,
  ...over,
});

describe('evaluatePromo', () => {
  it('flat discount when every rule passes', () => {
    expect(evaluatePromo(promo(), ctx())).toEqual({ ok: true, discountPaise: 5000, merchantSharePaise: 0 });
  });

  it('percent discount is capped and the merchant share is split', () => {
    const p = promo({ kind: 'percent', value: 20, maxDiscountPaise: 6000, merchantSharePercent: 50, minOrderPaise: 0 });
    expect(evaluatePromo(p, ctx({ itemsPaise: 20000 }))).toEqual({ ok: true, discountPaise: 4000, merchantSharePaise: 2000 });
    expect(evaluatePromo(p, ctx({ itemsPaise: 90000 }))).toEqual({ ok: true, discountPaise: 6000, merchantSharePaise: 3000 });
  });

  it.each([
    ['inactive', promo({ active: false }), ctx()],
    ['not_started', promo({ validFrom: new Date('2026-12-01T00:00:00Z') }), ctx()],
    ['expired', promo({ validTo: now }), ctx()],
    ['not_applicable', promo({ microMarketIds: ['other'] }), ctx()],
    ['not_applicable', promo({ merchantTypes: ['home_kitchen'] }), ctx()],
    ['not_applicable', promo({ merchantIds: ['m2'] }), ctx()],
    ['first_order_only', promo({ firstOrderOnly: true }), ctx({ userPlacedOrders: 1 })],
    ['limit_reached', promo(), ctx({ userRedemptions: 1 })],
    ['min_order', promo(), ctx({ itemsPaise: 19899 })],
    ['budget_exhausted', promo({ spentPaise: 96_000 }), ctx()],
  ] as const)('rejects: %s', (reason, p, c) => {
    expect(evaluatePromo(p, c)).toMatchObject({ ok: false, reason });
  });

  it('budget is exhausted exactly when the next discount would overshoot it', () => {
    expect(evaluatePromo(promo({ spentPaise: 95_000 }), ctx())).toMatchObject({ ok: true });
    expect(evaluatePromo(promo({ spentPaise: 95_001 }), ctx())).toMatchObject({ ok: false, reason: 'budget_exhausted' });
    expect(evaluatePromo(promo({ budgetPaise: null, spentPaise: 9e9 }), ctx())).toMatchObject({ ok: true });
  });
});

describe('helpers', () => {
  it('codes are case-insensitive', () => expect(normaliseCode(' nellore50 ')).toBe('NELLORE50'));
  it('raw discount never exceeds items', () => expect(rawDiscount({ kind: 'flat', value: 5000, maxDiscountPaise: null }, 3000)).toBe(3000));
});
