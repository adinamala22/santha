import { describe, expect, it } from 'vitest';
import { buildReport, type ReportDelivery, type ReportOrder } from './reports';

const order = (id: string, over: Partial<ReportOrder> = {}): ReportOrder => ({
  id, merchantId: 'm1', state: 'DELIVERED', placed: true, accepted: true, itemsPaise: 10_000, feesPaise: 3_000, discountPaise: 0, prepMin: 10, ...over,
});
const delivery = (orderId: string, over: Partial<ReportDelivery> = {}): ReportDelivery => ({
  orderId, merchantId: 'm1', riderUserId: 'r1', mode: 'rider', onTime: true, riderPayPaise: 4_000, storeCreditPaise: 0, ...over,
});

describe('reports', () => {
  it('funnel, on-time, fill rate and contribution per order', () => {
    const r = buildReport({
      orders: [order('a'), order('b'), order('c', { state: 'REJECTED', accepted: false, prepMin: null }), order('d', { state: 'EXPIRED', accepted: false, prepMin: null }), order('e', { placed: false, state: 'PAYMENT_FAILED', accepted: false })],
      deliveries: [delivery('a'), delivery('b', { mode: 'self', riderUserId: null, riderPayPaise: 0, storeCreditPaise: 2_500, onTime: false })],
      platformRefundsPaise: 2_000,
      issuesByMerchant: new Map([['m1', 1]]),
      ratingByMerchant: new Map([['m1', 4.5]]),
      rates: { commissionSelfPercent: 6, commissionRiderPercent: 9 },
    });
    expect(r.funnel).toEqual({ placed: 4, accepted: 2, delivered: 2, cancelled: 0, rejected: 1, expired: 1 });
    expect(r.onTimePercent).toBe(50);
    expect(r.fillRatePercent).toBe(50);
    // commission 900 + 600, fees 6000, rider 4000, credit 2500, platform refunds 2000
    expect(r.contribution.totalPaise).toBe(900 + 600 + 6_000 - 4_000 - 2_500 - 2_000);
    expect(r.contribution.perOrderPaise).toBe(-500);
    expect(r.merchants[0]).toEqual({ merchantId: 'm1', orders: 4, acceptancePercent: 50, avgPrepMin: 10, issueRatePercent: 50, rating: 4.5 });
    expect(r.riders).toEqual([{ riderUserId: 'r1', deliveries: 1, onTimePercent: 100, earningsPaise: 4_000 }]);
  });

  it('empty period: no division by zero', () => {
    const r = buildReport({ orders: [], deliveries: [], platformRefundsPaise: 0, issuesByMerchant: new Map(), ratingByMerchant: new Map(), rates: { commissionSelfPercent: 6, commissionRiderPercent: 9 } });
    expect(r.onTimePercent).toBeNull();
    expect(r.contribution.perOrderPaise).toBeNull();
  });
});
