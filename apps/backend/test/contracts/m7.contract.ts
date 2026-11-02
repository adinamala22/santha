/** M7 repository contracts — settlement runs, payouts, refunds (CAS), reconciliation, disputes, issues, ratings. */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { MoneyRepository } from '../../src/modules/payments-settlement/settlement/money.repository';
import type { IssuesRepository } from '../../src/modules/trust-safety/issues.repository';

const day = (d: string) => new Date(`${d}T00:00:00+05:30`);

export function moneyRepositoryContract(name: string, make: () => Promise<MoneyRepository>) {
  describe(`MoneyRepository contract · ${name}`, () => {
    it('one run per kind and period; payouts per party, newest first; carried balances found', async () => {
      const repo = await make();
      const start = day(`2031-0${1 + Math.floor(Math.random() * 8)}-1${Math.floor(Math.random() * 9)}`);
      const end = new Date(start.getTime() + 86_400_000);
      const run = (await repo.createRun({ id: randomUUID(), kind: 'merchant', periodStart: start, periodEnd: end, status: 'running', totals: {}, createdBy: null }))!;
      expect(await repo.createRun({ id: randomUUID(), kind: 'merchant', periodStart: start, periodEnd: end, status: 'running', totals: {}, createdBy: null })).toBeNull();
      expect((await repo.findRun('merchant', start, end))?.id).toBe(run.id);
      await repo.finishRun(run.id, 'completed', { payouts: 1 });
      const party = randomUUID();
      const base = { runId: run.id, partyType: 'merchant' as const, partyId: party, microMarketId: null, periodStart: start, periodEnd: end, grossPaise: 1000, lines: [{ code: 'SN1', netPaise: -500 }], totals: { netPaise: -500 }, tcsPaise: 5, tdsPaise: 1, status: 'on_hold' as const, transferRef: null, failureReason: null, statementKey: null };
      const p = await repo.createPayout({ ...base, id: randomUUID(), netPaise: -500 });
      await expect(repo.createPayout({ ...base, id: randomUUID(), netPaise: 1 })).rejects.toThrow();
      expect((await repo.lastPayout('merchant', party, end))?.id).toBe(p.id);
      expect(await repo.lastPayout('merchant', party, start)).toBeNull();
      await repo.updatePayout(p.id, { transferRef: 'carried:x' });
      expect((await repo.payoutsForParty('merchant', party, 5))[0]).toMatchObject({ id: p.id, transferRef: 'carried:x', lines: [{ code: 'SN1', netPaise: -500 }] });
      expect((await repo.payoutsForRun(run.id)).map((x) => x.id)).toContain(p.id);
    });

    it('refunds: compare-and-swap on status; store-liable processed refunds by window', async () => {
      const repo = await make();
      const merchantId = randomUUID();
      const r = await repo.createRefund({
        id: randomUUID(), orderId: randomUUID(), issueId: null, userId: randomUUID(), merchantId, microMarketId: randomUUID(), amountPaise: 1500, destination: 'wallet', liability: 'merchant',
        reason: 'missing_item', status: 'pending', approvals: [], rejectedBy: null, rejectNote: null, providerRef: null, failureReason: null,
      });
      const [a, b] = await Promise.all([
        repo.updateRefund(r.id, ['pending'], { status: 'processed', processedAt: new Date() }),
        repo.updateRefund(r.id, ['pending'], { status: 'rejected' }),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      const done = (await repo.refund(r.id))!;
      if (done.status === 'processed') {
        expect((await repo.merchantLiableRefunds(merchantId, new Date(Date.now() - 60_000), new Date(Date.now() + 60_000))).map((x) => x.id)).toEqual([r.id]);
      }
      expect((await repo.refunds({ orderId: r.orderId, limit: 5 })).length).toBe(1);
      await repo.updateRefund(r.id, ['processed', 'rejected'], { approvals: [{ userId: randomUUID(), at: new Date().toISOString() }] });
      expect((await repo.refund(r.id))!.approvals).toHaveLength(1);
    });

    it('reconciliation exceptions are unique per day, payment and kind; disputes CAS', async () => {
      const repo = await make();
      const e = { reportDate: '2031-01-01', kind: 'amount_mismatch' as const, providerPaymentId: `pay_${randomUUID().slice(0, 8)}`, expectedPaise: 100, reportedPaise: 99 };
      expect(await repo.addReconException(e)).toBe(true);
      expect(await repo.addReconException(e)).toBe(false);
      const open = (await repo.reconExceptions('open')).find((x) => x.providerPaymentId === e.providerPaymentId)!;
      expect(await repo.resolveRecon(open.id, randomUUID(), 'ok')).toMatchObject({ status: 'resolved' });
      expect(await repo.resolveRecon(open.id, randomUUID(), 'again')).toBeNull();
      const d = await repo.createDispute({ id: randomUUID(), merchantId: randomUUID(), orderId: null, refundId: randomUUID(), payoutId: null, reason: 'evidence attached', evidenceMediaIds: [], deadlineAt: new Date() });
      expect(await repo.updateDispute(d.id, ['open'], { status: 'accepted', adjustmentPaise: 1500 })).toMatchObject({ status: 'accepted' });
      expect(await repo.updateDispute(d.id, ['open'], { status: 'rejected' })).toBeNull();
      expect((await repo.disputes({ merchantId: d.merchantId, statuses: ['accepted'], limit: 5 }))[0]!.adjustmentPaise).toBe(1500);
    });
  });
}

export function issuesRepositoryContract(name: string, make: () => Promise<IssuesRepository>) {
  describe(`IssuesRepository contract · ${name}`, () => {
    it('issues by order and user; one rating per order; averages', async () => {
      const repo = await make();
      const orderId = randomUUID();
      const userId = randomUUID();
      const merchantId = randomUUID();
      const i = await repo.createIssue({
        id: randomUUID(), orderId, userId, merchantId, type: 'missing_item', variantIds: [randomUUID()], description: null, photoMediaIds: [], claimedPaise: 2500,
        status: 'pending_review', trustScore: 0.8, decision: { mode: 'manual' }, refundId: null,
      });
      await repo.updateIssue(i.id, { status: 'approved', decidedAt: new Date() });
      expect((await repo.issues({ orderId, limit: 5 }))[0]).toMatchObject({ status: 'approved', decision: { mode: 'manual' } });
      expect(await repo.issues({ userId, statuses: ['rejected'], limit: 5 })).toEqual([]);
      const riderUserId = randomUUID();
      expect(await repo.addRating({ orderId, userId, merchantId, riderUserId, storeStars: 4, riderStars: 5, comment: null })).toBe(true);
      expect(await repo.addRating({ orderId, userId, merchantId, riderUserId, storeStars: 1, riderStars: 1, comment: null })).toBe(false);
      expect(await repo.averages({ riderUserId })).toEqual({ count: 1, avg: 5 });
      expect((await repo.averages({ merchantId })).avg).toBe(4);
    });
  });
}
