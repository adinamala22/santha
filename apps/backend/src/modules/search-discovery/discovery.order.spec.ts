import { describe, expect, it } from 'vitest';
import { orderStores, type StoreCard } from './discovery.service';

const card = (id: string, over: Partial<StoreCard>): StoreCard => ({
  id, name: id, nameTe: null, type: 'home_kitchen', category: null, photoUrl: null, distanceM: 100, deliverable: true, beyondRadius: false, deliversAnywhere: false,
  eta: { mode: 'asap', minMin: 20, maxMin: 30 }, open: true, nextOpenAt: null, closesAt: null, selfDelivers: false,
  hygieneDeclared: true, rating: null, ratingCount: 0, movPaise: 0, itemCount: 1, score: 0.5, ...over,
});
const slot = (date: string, start: string) => ({ mode: 'scheduled' as const, nextSlot: { date, start, end: '23:59', cutoffAt: new Date() } });

describe('feed order', () => {
  it('scheduled kitchens: soonest open slot first regardless of score; no slot last', () => {
    const tomorrow = card('padma', { eta: slot('2026-11-03', '12:30'), score: 0.9 });
    const today = card('saraswathi', { eta: slot('2026-11-02', '13:30'), score: 0.4 });
    const none = card('closed', { eta: { mode: 'scheduled', nextSlot: null }, score: 0.99 });
    expect([tomorrow, none, today].sort(orderStores).map((c) => c.id)).toEqual(['saraswathi', 'padma', 'closed']);
  });
  it('ASAP stores: open by score, closed last by next opening', () => {
    const a = card('a', { score: 0.3 });
    const b = card('b', { score: 0.8 });
    const c = card('c', { open: false, nextOpenAt: new Date('2026-11-03T02:00:00Z'), score: 0.99 });
    expect([c, a, b].sort(orderStores).map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });
  it('stores that cannot deliver here come after every store that can, open or not (ADR-021)', () => {
    const far = card('far', { deliverable: false, score: 0.99 });
    const farClosed = card('far-closed', { deliverable: false, open: false, nextOpenAt: new Date('2026-11-03T02:00:00Z') });
    const closed = card('closed', { open: false, nextOpenAt: new Date('2026-11-03T02:00:00Z') });
    const near = card('near', { score: 0.1 });
    expect([far, farClosed, closed, near].sort(orderStores).map((x) => x.id)).toEqual(['near', 'closed', 'far', 'far-closed']);
  });
});
