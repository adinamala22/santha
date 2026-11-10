import { describe, expect, it } from 'vitest';
import {
  approve,
  computeMerchantPayout,
  computeRiderPayout,
  DEFAULT_PAYOUT_RATES,
  type DeliveredOrder,
  decideRefund,
  istDay,
  previousIstWeek,
  reconcile,
  trustScore,
  withinWindow,
} from './money';

const order = (over: Partial<DeliveredOrder> = {}): DeliveredOrder => ({
  orderId: 'o1', code: 'SN1', mode: 'rider', itemsPaise: 50_000, merchantRefundsPaise: 0, packagingPaise: 0, deliveryFeePaise: 3_000, selfBonusPaise: 0, codCollectedByStorePaise: 0, ...over,
});

describe('merchant payout', () => {
  it('rider-delivered: items − 9% commission − 18% GST on it − TCS 0.5% − TDS 0.1%; no delivery credit', () => {
    const p = computeMerchantPayout([order()], DEFAULT_PAYOUT_RATES);
    const l = p.lines[0]!;
    expect(l).toMatchObject({ commissionPaise: 4_500, commissionGstPaise: 810, tcsPaise: 250, tdsPaise: 50, deliveryCreditPaise: 0 });
    expect(l.netPaise).toBe(50_000 - 4_500 - 810 - 250 - 50);
    expect(p.totals.cgstPaise + p.totals.sgstPaise).toBe(810);
  });

  it('self-delivered: 6% commission, delivery fee and bonus credited, COD cash already with the store is deducted', () => {
    const p = computeMerchantPayout([order({ mode: 'self', selfBonusPaise: 2_000, codCollectedByStorePaise: 56_000, packagingPaise: 1_000, merchantRefundsPaise: 5_000 })], DEFAULT_PAYOUT_RATES);
    const l = p.lines[0]!;
    expect(l.itemsPaise).toBe(45_000);
    expect(l.commissionPaise).toBe(2_700);
    expect(l.netPaise).toBe(45_000 + 1_000 + 3_000 + 2_000 - 2_700 - 486 - 225 - 45 - 56_000);
  });

  it('totals equal the sum of lines plus adjustments, to the paisa, for many odd amounts', () => {
    const orders = Array.from({ length: 37 }, (_, i) => order({ orderId: `o${i}`, itemsPaise: 1_237 * (i + 3), mode: i % 3 ? 'rider' : 'self', packagingPaise: i * 7 }));
    const p = computeMerchantPayout(orders, DEFAULT_PAYOUT_RATES, -1_234);
    expect(p.totals.netPaise).toBe(p.lines.reduce((s, l) => s + l.netPaise, 0) - 1_234);
    expect(p.totals.cgstPaise + p.totals.sgstPaise).toBe(p.lines.reduce((s, l) => s + l.commissionGstPaise, 0));
    for (const l of p.lines) expect(Number.isInteger(l.netPaise)).toBe(true);
  });
});

describe('rider payout', () => {
  it('pay minus COD cash in hand; can go negative', () => {
    expect(computeRiderPayout([{ orderId: 'a', code: 'A', payPaise: 4_400, codCollectedPaise: 0 }, { orderId: 'b', code: 'B', payPaise: 5_000, codCollectedPaise: 20_000 }])).toEqual({
      deliveries: 2, earnedPaise: 9_400, incentivesPaise: 0, lateTipsPaise: 0, cashHeldPaise: 20_000, depositsPaise: 0, adjustmentsPaise: 0, netPaise: -10_600,
    });
  });

  it('ADR-032: incentive bonuses add; cash already deposited with Santha is not deducted twice', () => {
    const p = computeRiderPayout([{ orderId: 'b', code: 'B', payPaise: 5_000, codCollectedPaise: 20_000 }], 0, { incentivesPaise: 15_000, depositsPaise: 20_000 });
    expect(p).toMatchObject({ earnedPaise: 5_000, incentivesPaise: 15_000, cashHeldPaise: 20_000, depositsPaise: 20_000, netPaise: 20_000 });
  });

  it('ADR-037: tips paid after the delivery are added in full to the rider payout', () => {
    const p = computeRiderPayout([{ orderId: 'a', code: 'A', payPaise: 4_400, codCollectedPaise: 0 }], 0, { lateTipsPaise: 3_000 });
    expect(p).toMatchObject({ earnedPaise: 4_400, lateTipsPaise: 3_000, netPaise: 7_400 });
    // A rider whose only income in the period is a late tip still gets a payout line.
    expect(computeRiderPayout([], 0, { lateTipsPaise: 2_000 })).toMatchObject({ deliveries: 0, earnedPaise: 0, netPaise: 2_000 });
  });

  it("ADR-032: the tip is the store's only when its own staff delivered", () => {
    const base = { orderId: 'o', code: 'O', itemsPaise: 10_000, merchantRefundsPaise: 0, packagingPaise: 0, deliveryFeePaise: 0, selfBonusPaise: 0, codCollectedByStorePaise: 0, tipPaise: 2_000 };
    const self = computeMerchantPayout([{ ...base, mode: 'self' }], DEFAULT_PAYOUT_RATES).lines[0]!;
    const rider = computeMerchantPayout([{ ...base, mode: 'rider' }], DEFAULT_PAYOUT_RATES).lines[0]!;
    expect(self.tipPaise).toBe(2_000);
    expect(rider.tipPaise).toBe(0);
    expect(self.netPaise - rider.netPaise).toBe(2_000 + Math.round(10_000 * 0.03) + Math.round(Math.round(10_000 * 0.03) * 0.18) - 0); // tip + the lower self commission and its GST
  });
});

describe('refund decisions', () => {
  it('small item problem from a trusted customer: auto, wallet, store-liable', () => {
    expect(decideRefund({ type: 'missing_item', claimedPaise: 6_000, merchantKind: 'retail' }, 0.8, 50_000)).toMatchObject({ mode: 'auto', amountPaise: 6_000, destination: 'wallet', liability: 'merchant' });
  });
  it('over the auto limit or low trust: a person decides', () => {
    expect(decideRefund({ type: 'damaged', claimedPaise: 40_000, merchantKind: 'retail' }, 0.9, 50_000).mode).toBe('manual');
    expect(decideRefund({ type: 'quality', claimedPaise: 2_000, merchantKind: 'home_kitchen' }, 0.4, 50_000)).toMatchObject({ mode: 'manual', reason: 'low_trust' });
  });
  it('never refunds more than what is left of the order', () => {
    expect(decideRefund({ type: 'wrong_item', claimedPaise: 9_000, merchantKind: 'retail' }, 0.9, 5_000).amountPaise).toBe(5_000);
    expect(decideRefund({ type: 'wrong_item', claimedPaise: 9_000, merchantKind: 'retail' }, 0.9, 0).mode).toBe('reject');
  });
  it('late: flat platform credit only past 15 min; non-delivery and returns go to a person', () => {
    expect(decideRefund({ type: 'late', claimedPaise: 0, lateMin: 25, merchantKind: 'retail' }, 0.8, 50_000)).toMatchObject({ mode: 'auto', amountPaise: 2_000, liability: 'platform' });
    expect(decideRefund({ type: 'late', claimedPaise: 0, lateMin: 10, merchantKind: 'retail' }, 0.8, 50_000).mode).toBe('reject');
    expect(decideRefund({ type: 'not_delivered', claimedPaise: 50_000, merchantKind: 'retail' }, 1, 50_000)).toMatchObject({ mode: 'manual', liability: 'rider' });
    expect(decideRefund({ type: 'return_request', claimedPaise: 120_000, merchantKind: 'fashion' }, 1, 150_000)).toMatchObject({ mode: 'manual', reason: 'return_pickup' });
  });
});

describe('windows, trust, approvals', () => {
  const d = new Date('2026-11-02T06:00:00Z');
  it('2 h cooked / 24 h retail / 48 h fashion', () => {
    expect(withinWindow('home_kitchen', d, new Date(d.getTime() + 119 * 60_000))).toBe(true);
    expect(withinWindow('home_kitchen', d, new Date(d.getTime() + 121 * 60_000))).toBe(false);
    expect(withinWindow('retail', d, new Date(d.getTime() + 23 * 3_600_000))).toBe(true);
    expect(withinWindow('fashion', d, new Date(d.getTime() + 47 * 3_600_000))).toBe(true);
    expect(withinWindow('retail', d, new Date(d.getTime() + 25 * 3_600_000))).toBe(false);
  });
  it('trust starts at 0.8, drops with refunds and rejections, flags frequent issues', () => {
    expect(trustScore({ delivered: 0, refundsLast30d: 0, rejectedIssues: 0, issuesLast7d: 0 }).score).toBe(0.8);
    expect(trustScore({ delivered: 30, refundsLast30d: 1, rejectedIssues: 0, issuesLast7d: 1 }).score).toBe(0.95);
    const bad = trustScore({ delivered: 2, refundsLast30d: 5, rejectedIssues: 1, issuesLast7d: 4 });
    expect(bad.score).toBeLessThan(0.6);
    expect(bad.flags).toEqual(['frequent_issues', 'refund_heavy']);
  });
  it('four-eyes above ₹1,000; ops capped at ₹2,000; nobody approves twice', () => {
    expect(approve(50_000, [], { userId: 'a', roles: ['ops'] })).toEqual({ ok: true, complete: true });
    expect(approve(150_000, [], { userId: 'a', roles: ['ops'] })).toEqual({ ok: true, complete: false });
    expect(approve(150_000, ['a'], { userId: 'a', roles: ['ops'] })).toEqual({ ok: false, reason: 'same_approver' });
    expect(approve(150_000, ['a'], { userId: 'b', roles: ['finance'] })).toEqual({ ok: true, complete: true });
    expect(approve(250_000, [], { userId: 'c', roles: ['ops'] })).toEqual({ ok: false, reason: 'over_limit' });
  });
});

describe('reconciliation and periods', () => {
  it('matches to the paisa and lists every exception', () => {
    const r = reconcile(
      [{ providerPaymentId: 'p1', amountPaise: 100 }, { providerPaymentId: 'p2', amountPaise: 200 }, { providerPaymentId: 'p3', amountPaise: 300 }],
      [{ providerPaymentId: 'p1', amountPaise: 100, feePaise: 2 }, { providerPaymentId: 'p2', amountPaise: 199, feePaise: 4 }, { providerPaymentId: 'p9', amountPaise: 50, feePaise: 1 }],
    );
    expect(r.matched).toBe(1);
    expect(r.exceptions.map((e) => `${e.kind}:${e.providerPaymentId}`)).toEqual(['amount_mismatch:p2', 'missing_in_report:p3', 'unknown_in_report:p9']);
  });
  it('IST day and previous Mon–Sun week', () => {
    expect(istDay('2026-11-02').start.toISOString()).toBe('2026-11-01T18:30:00.000Z');
    const w = previousIstWeek('2026-11-04'); // a Wednesday
    expect(w.start.toISOString()).toBe('2026-10-25T18:30:00.000Z'); // Mon 26 Oct IST
    expect(w.end.toISOString()).toBe('2026-11-01T18:30:00.000Z'); // Mon 2 Nov IST
  });
});
