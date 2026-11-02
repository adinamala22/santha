import { describe, expect, it } from 'vitest';
import { $Enums } from '@prisma/client';
import { assertTransition, canTransition, EVENT_FOR, isTerminal, nextStates, type OrderActor, type OrderState } from './state-machine';

const STATES = Object.values($Enums.OrderState) as OrderState[];
const ACTORS: OrderActor[] = ['customer', 'merchant', 'rider', 'staff', 'ops', 'system'];

/** Every legal (from, to, actor) — the state-machine reference, spelled out. */
const LEGAL: Array<[OrderState, OrderState, OrderActor[]]> = [
  ['AWAITING_PAYMENT', 'PLACED', ['system']],
  ['AWAITING_PAYMENT', 'PAYMENT_FAILED', ['system', 'customer']],
  ['PLACED', 'ACCEPTED', ['merchant', 'ops']],
  ['PLACED', 'REJECTED', ['merchant', 'ops']],
  ['PLACED', 'EXPIRED', ['system']],
  ['PLACED', 'CANCELLED', ['customer', 'ops']],
  ['ACCEPTED', 'PREPARING', ['merchant', 'ops']],
  ['ACCEPTED', 'CANCELLED', ['customer', 'merchant', 'ops']],
  ['PREPARING', 'READY', ['merchant', 'ops']],
  ['PREPARING', 'CANCELLED', ['merchant', 'ops']],
  ['READY', 'PICKED_UP', ['rider', 'staff', 'ops']],
  ['PICKED_UP', 'OUT_FOR_DELIVERY', ['rider', 'staff', 'system', 'ops']],
  ['OUT_FOR_DELIVERY', 'DELIVERED', ['rider', 'staff', 'ops']],
  ['OUT_FOR_DELIVERY', 'FAILED_DELIVERY', ['rider', 'staff', 'ops']],
  ['FAILED_DELIVERY', 'OUT_FOR_DELIVERY', ['rider', 'staff', 'ops']],
  ['FAILED_DELIVERY', 'CANCELLED', ['ops', 'system']],
];

describe('order state machine', () => {
  it('allows exactly the legal edges, for exactly the listed actors', () => {
    for (const from of STATES)
      for (const to of STATES)
        for (const actor of ACTORS) {
          const legal = LEGAL.some(([f, t, a]) => f === from && t === to && a.includes(actor));
          expect(canTransition(from, to, actor), `${from} → ${to} by ${actor}`).toBe(legal);
        }
  });

  it('terminal states have no way out', () => {
    for (const s of STATES.filter(isTerminal)) expect(nextStates(s)).toEqual([]);
  });

  it('cooked food: customer may cancel only before the kitchen accepts', () => {
    expect(canTransition('PLACED', 'CANCELLED', 'customer', { cookedFood: true })).toBe(true);
    expect(canTransition('ACCEPTED', 'CANCELLED', 'customer', { cookedFood: true })).toBe(false);
    expect(canTransition('ACCEPTED', 'CANCELLED', 'merchant', { cookedFood: true })).toBe(true);
  });

  it('illegal moves throw INVALID_STATE with details', () => {
    expect(() => assertTransition('DELIVERED', 'CANCELLED', 'ops')).toThrowError(expect.objectContaining({ code: 'INVALID_STATE', details: { from: 'DELIVERED', to: 'CANCELLED', actor: 'ops' } }));
    expect(() => assertTransition('AWAITING_PAYMENT', 'PLACED', 'customer')).toThrow(/can't move/);
  });

  it('every state has an event name', () => {
    for (const s of STATES) expect(EVENT_FOR[s]).toMatch(/^(order|delivery)\.[a-z_]+$/);
  });
});
