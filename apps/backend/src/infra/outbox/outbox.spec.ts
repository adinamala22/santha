import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../config/env';
import type { QueuesService } from '../queues/queues.service';
import { buildEvent, DomainEvent } from './domain-event';
import { EventBus } from './event-bus';
import { EventsWorker } from './events.worker';
import { OutboxRelayService } from './outbox-relay.service';
import { ClaimedEvent, OutboxStore, PublishResult } from './outbox.store';
import type { PrismaService } from '../prisma/prisma.service';

const env = parseEnv(process.env);

const ev = (type: string): DomainEvent =>
  buildEvent({ type, aggregate: { type: 'user', id: 'u1' }, actor: { type: 'system', id: null }, payload: {} });

class FakeStore extends OutboxStore {
  rows: ClaimedEvent[] = [];
  published = new Set<string>();
  async claimAndPublish(limit: number, publish: (b: ClaimedEvent[]) => Promise<PublishResult>): Promise<PublishResult> {
    const batch = this.rows.filter((r) => !this.published.has(r.id)).slice(0, limit);
    if (!batch.length) return { published: [], failed: [] };
    const res = await publish(batch);
    res.published.forEach((id) => this.published.add(id));
    return res;
  }
}

describe('OutboxRelayService', () => {
  it('publishes unpublished events with jobId = event_id and marks them published', async () => {
    const store = new FakeStore();
    const e1 = ev('user.registered');
    const e2 = ev('user.role_granted');
    store.rows = [
      { id: e1.event_id, event: e1 },
      { id: e2.event_id, event: e2 },
    ];
    const add = vi.fn().mockResolvedValue({});
    const queues = { get: () => ({ add }) } as unknown as QueuesService;
    const relay = new OutboxRelayService(store, queues, env);

    expect(await relay.relayOnce()).toBe(2);
    expect(add).toHaveBeenCalledWith('user.registered', e1, { jobId: e1.event_id });
    expect(add).toHaveBeenCalledWith('user.role_granted', e2, { jobId: e2.event_id });
    expect(await relay.relayOnce()).toBe(0);
  });

  it('keeps failed events for retry', async () => {
    const store = new FakeStore();
    const e1 = ev('a.happened');
    const e2 = ev('b.happened');
    store.rows = [
      { id: e1.event_id, event: e1 },
      { id: e2.event_id, event: e2 },
    ];
    const add = vi.fn().mockRejectedValueOnce(new Error('redis down')).mockResolvedValue({});
    const relay = new OutboxRelayService(store, { get: () => ({ add }) } as unknown as QueuesService, env);
    await relay.relayOnce();
    expect([...store.published]).toEqual([e2.event_id]);
    await relay.relayOnce();
    expect(store.published.has(e1.event_id)).toBe(true);
  });
});

describe('EventsWorker', () => {
  it('runs each consumer once per event (dedupe on processed_events)', async () => {
    const processed = new Set<string>();
    const tx = {
      processedEvent: {
        createMany: async ({ data }: { data: Array<{ eventId: string; consumer: string }> }) => {
          const k = `${data[0]!.eventId}:${data[0]!.consumer}`;
          if (processed.has(k)) return { count: 0 };
          processed.add(k);
          return { count: 1 };
        },
      },
    };
    const prisma = { $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as PrismaService;
    const bus = new EventBus();
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    const all = vi.fn().mockResolvedValue(undefined);
    bus.on('user.registered', 'notifications', a);
    bus.on('user.registered', 'analytics', b);
    bus.on('*', 'audit-log', all);
    const worker = new EventsWorker(bus, prisma, env);

    const e = ev('user.registered');
    await worker.process({ data: e });
    await worker.process({ data: e }); // redelivery
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate registrations', () => {
    const bus = new EventBus();
    bus.on('x.y', 'c', vi.fn());
    expect(() => bus.on('x.y', 'c', vi.fn())).toThrow(/Duplicate/);
  });
});
