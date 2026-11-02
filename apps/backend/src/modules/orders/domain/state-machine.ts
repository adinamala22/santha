/**
 * Order state machine (.claude/skills/santha-architecture/references/order-state-machine.md).
 * The ONLY place that decides whether `orders.state` may change; OrderRepository.transition applies
 * a change with compare-and-swap on the current state inside a transaction, writes the history row
 * and the domain event. Nothing else writes `orders.state`.
 *
 * Before the lifecycle: online orders start in AWAITING_PAYMENT and become PLACED only when the
 * payment is captured (or PAYMENT_FAILED when it fails or is not completed in time). COD orders
 * start directly in PLACED once COD is authorised (ADR-010).
 */
import type { OrderState } from '@prisma/client';
import { DomainError } from '../../../common/errors/domain-error';

export type { OrderState };
export type OrderActor = 'customer' | 'merchant' | 'rider' | 'staff' | 'ops' | 'system';

export const TERMINAL: readonly OrderState[] = ['PAYMENT_FAILED', 'DELIVERED', 'CANCELLED', 'REJECTED', 'EXPIRED'];
/** States in which the order is real for the merchant (counts towards slot capacity, COD exposure…). */
export const LIVE: readonly OrderState[] = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'FAILED_DELIVERY'];

/** from → to → actors allowed to make that move. */
const EDGES: Partial<Record<OrderState, Partial<Record<OrderState, readonly OrderActor[]>>>> = {
  AWAITING_PAYMENT: { PLACED: ['system'], PAYMENT_FAILED: ['system', 'customer'] },
  PLACED: { ACCEPTED: ['merchant', 'ops'], REJECTED: ['merchant', 'ops'], EXPIRED: ['system'], CANCELLED: ['customer', 'ops'] },
  ACCEPTED: { PREPARING: ['merchant', 'ops'], CANCELLED: ['customer', 'merchant', 'ops'] },
  PREPARING: { READY: ['merchant', 'ops'], CANCELLED: ['merchant', 'ops'] },
  READY: { PICKED_UP: ['rider', 'staff', 'ops'] },
  PICKED_UP: { OUT_FOR_DELIVERY: ['rider', 'staff', 'system', 'ops'] },
  OUT_FOR_DELIVERY: { DELIVERED: ['rider', 'staff', 'ops'], FAILED_DELIVERY: ['rider', 'staff', 'ops'] },
  FAILED_DELIVERY: { OUT_FOR_DELIVERY: ['rider', 'staff', 'ops'], CANCELLED: ['ops', 'system'] },
};

/** Domain event emitted for each target state (events.md). */
export const EVENT_FOR: Record<OrderState, string> = {
  AWAITING_PAYMENT: 'order.created',
  PAYMENT_FAILED: 'order.payment_failed',
  PLACED: 'order.placed',
  ACCEPTED: 'order.accepted',
  PREPARING: 'order.preparing',
  READY: 'order.ready',
  PICKED_UP: 'order.picked_up',
  OUT_FOR_DELIVERY: 'order.out_for_delivery',
  DELIVERED: 'order.delivered',
  CANCELLED: 'order.cancelled',
  REJECTED: 'order.rejected',
  EXPIRED: 'order.expired',
  FAILED_DELIVERY: 'delivery.failed',
};

export interface TransitionContext {
  /** Home-kitchen orders: the customer cannot cancel once the kitchen accepted (food is being cooked). */
  cookedFood?: boolean;
}

export function canTransition(from: OrderState, to: OrderState, actor: OrderActor, ctx: TransitionContext = {}): boolean {
  const actors = EDGES[from]?.[to];
  if (!actors?.includes(actor)) return false;
  if (ctx.cookedFood && actor === 'customer' && to === 'CANCELLED' && from !== 'PLACED') return false;
  return true;
}

export function assertTransition(from: OrderState, to: OrderState, actor: OrderActor, ctx: TransitionContext = {}): void {
  if (!canTransition(from, to, actor, ctx))
    throw new DomainError('INVALID_STATE', `This order can't move from ${from} to ${to}.`, { from, to, actor });
}

export function nextStates(from: OrderState): OrderState[] {
  return Object.keys(EDGES[from] ?? {}) as OrderState[];
}

export const isTerminal = (s: OrderState) => TERMINAL.includes(s);
