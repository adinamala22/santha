/** M8 repository contracts — grievances (CAS), consent ledger, data requests, leads, review moderation. */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LeadsRepository } from '../../src/modules/analytics-config/growth/leads.repository';
import type { ComplianceRepository } from '../../src/modules/trust-safety/compliance.repository';
import type { IssuesRepository } from '../../src/modules/trust-safety/issues.repository';

export function complianceRepositoryContract(name: string, make: () => Promise<{ repo: ComplianceRepository; userId: () => Promise<string> }>) {
  describe(`ComplianceRepository contract · ${name}`, () => {
    it('grievances move open → acknowledged → resolved once each', async () => {
      const { repo, userId } = await make();
      const u = await userId();
      const g = await repo.createGrievance({ id: randomUUID(), userId: u, app: 'consumer', orderId: null, category: 'refund', description: 'Refund missing for a week', status: 'open', ackDueAt: new Date(), resolveDueAt: new Date(), createdAt: new Date('2026-11-03T05:00:00.000Z') });
      expect(g.createdAt.toISOString()).toBe('2026-11-03T05:00:00.000Z');
      expect(await repo.updateGrievance(g.id, ['open'], { status: 'acknowledged', acknowledgedAt: new Date() })).toMatchObject({ status: 'acknowledged' });
      expect(await repo.updateGrievance(g.id, ['open'], { status: 'acknowledged' })).toBeNull();
      await repo.updateGrievance(g.id, ['acknowledged'], { status: 'resolved', resolution: 'done', resolvedAt: new Date() });
      expect((await repo.grievances({ userId: u, statuses: ['resolved'], limit: 5 }))[0]!.resolution).toBe('done');
    });

    it('consents are an append-only ledger in order; data requests update', async () => {
      const { repo, userId } = await make();
      const u = await userId();
      await repo.addConsent({ userId: u, purpose: 'marketing', version: 'v1', granted: true, source: 'app' });
      await repo.addConsent({ userId: u, purpose: 'marketing', version: 'v1', granted: false, source: 'app' });
      expect((await repo.consents(u)).map((c) => c.granted)).toEqual([true, false]);
      const r = await repo.createDataRequest({ userId: u, type: 'access', details: null });
      expect(r.status).toBe('open');
      await repo.updateDataRequest(r.id, { status: 'completed', exportKey: 'k', completedAt: new Date() });
      expect((await repo.dataRequests({ userId: u, limit: 5 }))[0]).toMatchObject({ status: 'completed', exportKey: 'k' });
      expect(await repo.dataRequests({ userId: u, statuses: ['open'], limit: 5 })).toEqual([]);
    });
  });
}

export function leadsRepositoryContract(name: string, make: () => Promise<LeadsRepository>) {
  describe(`LeadsRepository contract · ${name}`, () => {
    it('creates, finds recent by phone and kind, updates status', async () => {
      const repo = await make();
      const phone = `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
      const l = await repo.create({ id: randomUUID(), kind: 'store', name: 'Kirana', phone, area: null, message: null, locale: 'te' });
      expect(l.status).toBe('new');
      expect((await repo.recent(phone, 'store', new Date(Date.now() - 60_000)))?.id).toBe(l.id);
      expect(await repo.recent(phone, 'rider', new Date(Date.now() - 60_000))).toBeNull();
      const audit = { action: 'lead.updated', actorId: null };
      expect(await repo.update(l.id, { status: 'converted', note: 'live' }, audit)).toMatchObject({ status: 'converted', note: 'live' });
      expect(await repo.update(randomUUID(), { status: 'dropped' }, audit)).toBeNull();
    });
  });
}

export function reviewModerationContract(name: string, make: () => Promise<IssuesRepository>) {
  describe(`Review moderation contract · ${name}`, () => {
    it('flagged reviews are queued; hidden ones leave the store average', async () => {
      const repo = await make();
      const merchantId = randomUUID();
      const a = randomUUID();
      const b = randomUUID();
      await repo.addRating({ orderId: a, userId: randomUUID(), merchantId, riderUserId: null, storeStars: 5, riderStars: null, comment: 'good' });
      await repo.addRating({ orderId: b, userId: randomUUID(), merchantId, riderUserId: null, storeStars: 1, riderStars: null, comment: 'call 98...', status: 'flagged', flagReason: 'contact_details' });
      expect((await repo.ratings({ merchantId, statuses: ['flagged'], limit: 5 })).map((r) => r.orderId)).toEqual([b]);
      await repo.updateRating(b, { status: 'hidden' });
      await repo.updateRating(a, { reply: 'thanks', replyAt: new Date() });
      expect(await repo.averages({ merchantId })).toEqual({ count: 1, avg: 5 });
      expect((await repo.rating(a))!.reply).toBe('thanks');
    });
  });
}
