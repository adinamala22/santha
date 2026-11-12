import { describe, expect, it } from 'vitest';
import {
  type Candidate,
  batchEligible,
  batchImpactMin,
  fourDigits,
  haversineM,
  liveEta,
  nextFallbackStage,
  promisedAt,
  riderPay,
  score,
  travelMin,
} from './dispatch';

const store = { lat: 14.4535, lng: 79.996 };
const metresNorth = (m: number) => ({ lat: store.lat + m / 111_195, lng: store.lng });
const rider = (id: string, m: number, extra: Partial<Candidate> = {}): Candidate => ({
  riderId: id,
  location: metresNorth(m),
  activeJobs: 0,
  rating: 4.5,
  offersShown: 10,
  offersAccepted: 8,
  ...extra,
});

describe('haversine and travel time', () => {
  it('measures a kilometre north as ~1000 m and 300 m per minute', () => {
    expect(Math.round(haversineM(store, metresNorth(1000)))).toBe(1000);
    expect(travelMin(1000)).toBe(4);
    expect(travelMin(0)).toBe(0);
  });
});

describe('score', () => {
  it('prefers the nearer rider when everything else is equal', () => {
    expect(score([rider('far', 3000), rider('near', 500)], store).map((c) => c.riderId)).toEqual([
      'near',
      'far',
    ]);
  });

  it('a busy rider loses to a free one a little further away; two jobs is full', () => {
    const ranked = score(
      [rider('busy', 400, { activeJobs: 1 }), rider('free', 900), rider('full', 100, { activeJobs: 2 })],
      store,
    );
    expect(ranked.map((c) => c.riderId)).toEqual(['free', 'busy']);
  });

  it('rating and acceptance history break near-ties; radius drops far riders', () => {
    const ranked = score(
      [
        rider('flaky', 600, { offersAccepted: 2 }),
        rider('steady', 650, { rating: 4.9 }),
        rider('away', 8000),
      ],
      store,
    );
    expect(ranked.map((c) => c.riderId)).toEqual(['steady', 'flaky']);
    expect(score([rider('away', 8000)], store, undefined, 12_000)).toHaveLength(1);
  });

  it('is deterministic on ties', () => {
    expect(score([rider('b', 500), rider('a', 500)], store).map((c) => c.riderId)).toEqual(['a', 'b']);
  });
});

describe('batching', () => {
  const a = { store, drop: metresNorth(2000) };
  it('same store, same direction: no detour', () => {
    expect(batchImpactMin(a, { store, drop: metresNorth(2500) })).toBe(0);
    expect(batchEligible(a, { store, drop: metresNorth(2500) })).toBe(true);
  });
  it('a store 1.5 km the other way is too far a detour (> 6 min)', () => {
    const b = { store: metresNorth(-1500), drop: metresNorth(2200) };
    expect(batchImpactMin(a, b)).toBeGreaterThan(6);
    expect(batchEligible(a, b)).toBe(false);
  });
});

describe('rider pay', () => {
  const cfg = { basePaise: 3000, perKmPaise: 500, waitPerMinPaise: 100, batchBonusPaise: 1500 };
  it('the base covers the first 5 km (ADR-038)', () => {
    for (const tripM of [500, 2000, 5000]) {
      expect(riderPay(cfg, { tripM })).toEqual({ totalPaise: 3000, lines: [{ code: 'base', amountPaise: 3000 }, { code: 'distance', amountPaise: 0 }] });
    }
  });
  it('each km beyond 5 km adds Rs 5, rounded up to 0.1 km', () => {
    expect(riderPay(cfg, { tripM: 6000 }).totalPaise).toBe(3500);
    expect(riderPay(cfg, { tripM: 8000 }).totalPaise).toBe(3000 + 1500);
    expect(riderPay(cfg, { tripM: 5010 }).lines[1]!.amountPaise).toBe(50);
  });
  it('waiting beyond 5 minutes and batching are paid', () => {
    const p = riderPay(cfg, { tripM: 1000, waitMin: 9.5, batched: true });
    expect(p.lines.map((l) => l.code)).toEqual(['base', 'distance', 'wait', 'batch']);
    expect(p.totalPaise).toBe(3000 + 0 + 400 + 1500);
  });
});

describe('ETA', () => {
  const now = new Date('2026-11-06T07:00:00Z');
  it('promise = ready + travel + buffer', () => {
    expect(promisedAt({ readyBy: now, storeToDropM: 1500, bufferMin: 8 }).toISOString()).toBe(
      '2026-11-06T07:13:00.000Z',
    );
  });
  it('live: picked up → straight to the drop; otherwise via the store, waiting for ready', () => {
    const drop = metresNorth(1500);
    expect(liveEta({ now, courier: metresNorth(600), store, drop, pickedUp: true }).toISOString()).toBe(
      '2026-11-06T07:03:00.000Z',
    );
    expect(liveEta({ now, courier: metresNorth(-600), store, drop, pickedUp: false }).toISOString()).toBe(
      '2026-11-06T07:07:00.000Z',
    );
    const readyAt = new Date('2026-11-06T07:10:00Z');
    expect(
      liveEta({ now, courier: metresNorth(-600), store, drop, pickedUp: false, readyAt }).toISOString(),
    ).toBe('2026-11-06T07:15:00.000Z');
  });
});

describe('fallback ladder and codes', () => {
  it('walks 3PL → self bonus → standby → customer notice, then stops', () => {
    const seen: string[] = [];
    for (let s = nextFallbackStage('none'); s; s = nextFallbackStage(s)) seen.push(s);
    expect(seen).toEqual(['tpl', 'self_bonus', 'standby', 'customer_notified']);
  });
  it('four-digit codes keep leading zeros', () => {
    expect(fourDigits(() => 0.0042)).toBe('0042');
    expect(fourDigits(() => 0.99999)).toBe('9999');
  });
});
