import { Injectable } from '@nestjs/common';
import { FAILED_REASONS } from './dto/dispatch.dto';
import { DomainError } from '../../common/errors/domain-error';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { MerchantsService } from '../merchant-catalogue/merchants.service';
import { OrdersService } from '../orders/orders.service';
import type { FulfilmentRecord, OfferRecord, RiderRecord } from './dispatch.repository';
import { DispatchService, istDayStart } from './dispatch.service';
import { RiderLocations } from './rider-locations';

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const pct = (n: number) => Math.round(n * 10) / 10;

/** Builds the API views for riders, staff, customers, merchants and ops from dispatch records. */
@Injectable()
export class DispatchViews {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly orders: OrdersService,
    private readonly merchants: MerchantsService,
    private readonly markets: MicroMarketsService,
    private readonly locations: RiderLocations,
  ) {}

  // ───────────── rider ─────────────

  async job(f: FulfilmentRecord, courier: 'rider' | 'staff') {
    const c = await this.dispatch.context(f);
    const o = c.order;
    return {
      id: f.id,
      orderId: o.id,
      code: o.code,
      mode: f.mode,
      state: f.state,
      orderState: o.state,
      store: {
        name: c.merchant.name,
        line: c.merchant.addressLine ?? null,
        lat: c.store.lat,
        lng: c.store.lng,
      },
      drop: {
        name: o.address.name,
        line: o.address.line,
        landmark: o.address.landmark,
        lat: c.drop.lat,
        lng: c.drop.lng,
      },
      instructions: o.instructions,
      itemCount: o.lines.filter((l) => (l.status ?? 'ok') !== 'removed').reduce((s, l) => s + l.quantity, 0),
      codDuePaise: o.paymentMethod === 'cod' ? Math.max(0, o.totalPaise - o.refundedPaise) : 0,
      payPaise: courier === 'rider' ? f.riderPayPaise : 0,
      payLines: courier === 'rider' ? f.payLines : [],
      callNumber: await this.dispatch.callNumber(o.id, 'courier', 'customer'),
      readyAt: iso(o.readyAt),
      arrivedAt: iso(f.arrivedAt),
      pickedUpAt: iso(f.pickedUpAt),
      deliveredAt: iso(f.deliveredAt),
      pickupCodeRequired: courier === 'rider',
      failedReason: f.state === 'failed' ? failedReasonOf(o.outcomeReason) : null,
      failedAt: iso(f.failedAt),
    };
  }

  async offer(o: OfferRecord) {
    const f = (await this.dispatch.fulfilmentById(o.fulfilmentId))!;
    const c = await this.dispatch.context(f);
    const market = await this.markets.get(f.microMarketId).catch(() => null);
    const now = this.dispatch.now();
    const readyBy = c.order.readyAt ?? c.order.packBy;
    return {
      id: o.id,
      expiresAt: o.expiresAt.toISOString(),
      payPaise: o.payPaise,
      payLines: o.payLines,
      pickup: {
        name: c.merchant.name,
        distanceM: o.distanceM,
        readyInMin: readyBy ? Math.max(0, Math.ceil((readyBy.getTime() - now.getTime()) / 60_000)) : null,
      },
      // Only the area until the rider accepts (privacy: exact address after assignment).
      drop: { area: market?.market.name ?? '', distanceM: f.storeToDropM },
    };
  }

  async riderHome(r: RiderRecord) {
    const [offers, jobs, earnings, markets] = await Promise.all([
      this.dispatch.openOffers(r.userId),
      this.dispatch.activeJobs(r.userId),
      this.dispatch.earnings(r.userId),
      this.markets.list(),
    ]);
    const zones = markets.map((m) => ({ id: m.market.id, name: m.market.name, nameTe: m.market.nameTe }));
    const live = offers.filter((o) => o.expiresAt > this.dispatch.now());
    return {
      name: r.name,
      vehicle: r.vehicle,
      online: r.online,
      zones: zones.filter((z) => r.zones.includes(z.id)),
      allZones: zones,
      rating: r.rating,
      today: {
        deliveries: earnings.deliveries.length,
        earningsPaise: earnings.totalPaise,
        onlineMin: await this.dispatch.onlineMinutes(r),
      },
      offer: live[0] ? await this.offer(live[0]) : null,
      jobs: await Promise.all(jobs.map((j) => this.job(j, 'rider'))),
    };
  }

  async earnings(r: RiderRecord) {
    const e = await this.dispatch.earnings(r.userId);
    const codes = await Promise.all(
      e.deliveries.map(async (f) => (await this.orders.get(f.orderId))?.code ?? ''),
    );
    return {
      totalPaise: e.totalPaise,
      onlineMin: await this.dispatch.onlineMinutes(r),
      deliveries: e.deliveries.map((f, i) => ({
        code: codes[i]!,
        deliveredAt: f.deliveredAt!.toISOString(),
        payPaise: f.riderPayPaise,
        payLines: f.payLines,
      })),
    };
  }

  // ───────────── customer ─────────────

  async tracking(userId: string, orderId: string) {
    const o = await this.orders.get(orderId);
    if (!o || o.userId !== userId) throw new DomainError('NOT_FOUND', 'Order not found');
    const f = await this.dispatch.fulfilmentForOrder(orderId);
    if (!f) throw new DomainError('NOT_FOUND', 'No delivery for this order yet');
    const c = await this.dispatch.context(f);
    const courier = await this.dispatch.courier(f);
    const assigned = f.state === 'assigned' || f.state === 'picked_up';
    return {
      orderId,
      mode: f.mode,
      state: f.state,
      courier:
        courier && f.state !== 'searching'
          ? { ...courier, callNumber: await this.dispatch.callNumber(orderId, 'customer', 'courier') }
          : null,
      deliveryOtp: assigned ? f.deliveryOtp : null,
      store: { name: c.merchant.name, ...c.store },
      drop: c.drop,
      // Location sharing ends at delivery (privacy).
      courierLocation:
        assigned && f.lastLat != null && f.lastLng != null
          ? { lat: f.lastLat, lng: f.lastLng, at: f.lastLocationAt!.toISOString() }
          : null,
      promisedAt: f.promisedAt.toISOString(),
      etaAt: iso(f.etaAt),
      fallbackStage: f.fallbackStage,
      canCancelNoCourier: f.state === 'searching' && f.fallbackStage === 'customer_notified',
    };
  }

  // ───────────── merchant ─────────────

  async merchantDelivery(f: FulfilmentRecord) {
    const courier = await this.dispatch.courier(f);
    return {
      orderId: f.orderId,
      mode: f.mode,
      state: f.state,
      pickupCode: f.pickupCode,
      courier:
        courier && f.state !== 'searching'
          ? { ...courier, callNumber: await this.dispatch.callNumber(f.orderId, 'store', 'courier') }
          : null,
      staffLink: f.mode === 'self' && f.staffToken ? this.dispatch.staffLink(f.staffToken) : null,
      deliveryOtp: null,
      fallbackStage: f.fallbackStage,
      selfBonusPaise: f.selfBonusPaise,
      promisedAt: f.promisedAt.toISOString(),
      etaAt: iso(f.etaAt),
    };
  }

  async statement(merchantId: string, microMarketId: string | null, date: string | undefined) {
    const now = this.dispatch.now();
    const day = date ? new Date(`${date}T00:00:00+05:30`) : istDayStart(now);
    const end = new Date(day.getTime() + 86_400_000);
    const fees = await this.dispatch.merchantFees(microMarketId ?? '');
    const delivered = (await this.dispatch.deliveredForMerchant(merchantId, day)).filter(
      (f) => f.deliveredAt! < end,
    );
    const lines: Array<{
      orderId: string;
      code: string;
      deliveredAt: string;
      mode: FulfilmentRecord['mode'];
      itemsPaise: number;
      commissionPercent: number;
      commissionPaise: number;
      deliveryFeeCreditPaise: number;
      selfBonusPaise: number;
      netPaise: number;
    }> = [];
    for (const f of delivered) {
      const o = (await this.orders.get(f.orderId))!;
      const self = f.mode === 'self';
      const rate = self ? fees.commissionSelfPercent : fees.commissionRiderPercent;
      const items = o.itemsPaise - o.lines.reduce((s, l) => s + (l.refundPaise ?? 0), 0);
      const commission = Math.round((items * rate) / 100);
      const bill = (o.quote as { bill?: { fees?: Array<{ code: string; amountPaise: number }> } } | null)
        ?.bill;
      const credit = self ? (bill?.fees ?? []).filter((x) => x.code === 'delivery' || x.code === 'beyond_radius').reduce((s, x) => s + x.amountPaise, 0) : 0;
      const bonus = self ? f.selfBonusPaise : 0;
      lines.push({
        orderId: o.id,
        code: o.code,
        deliveredAt: f.deliveredAt!.toISOString(),
        mode: f.mode,
        itemsPaise: items,
        commissionPercent: rate,
        commissionPaise: commission,
        deliveryFeeCreditPaise: credit,
        selfBonusPaise: bonus,
        netPaise: items - commission + credit + bonus,
      });
    }
    const sum = (
      k: 'itemsPaise' | 'commissionPaise' | 'deliveryFeeCreditPaise' | 'selfBonusPaise' | 'netPaise',
    ) => lines.reduce((s, l) => s + l[k], 0);
    return {
      date: new Date(day.getTime() + 330 * 60_000).toISOString().slice(0, 10),
      lines,
      totals: {
        orders: lines.length,
        itemsPaise: sum('itemsPaise'),
        commissionPaise: sum('commissionPaise'),
        deliveryFeeCreditPaise: sum('deliveryFeeCreditPaise'),
        selfBonusPaise: sum('selfBonusPaise'),
        netPaise: sum('netPaise'),
      },
    };
  }

  // ───────────── ops ─────────────

  async opsDelivery(orderId: string) {
    const o = await this.orders.get(orderId);
    if (!o) throw new DomainError('NOT_FOUND', 'Order not found');
    const f = await this.dispatch.fulfilmentForOrder(orderId);
    return this.opsRow(o, f, (await this.merchants.record(o.merchantId)).name);
  }

  private async opsRow(
    o: NonNullable<Awaited<ReturnType<OrdersService['get']>>>,
    f: FulfilmentRecord | null,
    merchantName: string,
  ) {
    const now = this.dispatch.now();
    const courier = f ? await this.dispatch.courier(f) : null;
    const m = await this.merchants.record(o.merchantId).catch(() => null);
    return {
      orderId: o.id,
      code: o.code,
      microMarketId: o.microMarketId,
      merchantName,
      orderState: o.state,
      totalPaise: o.totalPaise,
      paymentMethod: o.paymentMethod,
      mode: f?.mode ?? null,
      fulfilmentState: f?.state ?? null,
      courier: f && f.state !== 'searching' ? (courier?.name ?? null) : null,
      fallbackStage: f?.fallbackStage ?? null,
      searchingSec:
        f?.state === 'searching' ? Math.round((now.getTime() - f.requestedAt.getTime()) / 1000) : null,
      promisedAt: iso(f?.promisedAt),
      etaAt: iso(f?.etaAt),
      store: m?.location ?? null,
    };
  }

  async live() {
    const now = this.dispatch.now();
    const today = istDayStart(now);
    const recent = await this.orders.listRecent({ limit: 500 });
    const todays = recent.filter(
      (o) =>
        (o.placedAt ?? o.createdAt) >= today &&
        o.state !== 'AWAITING_PAYMENT' &&
        o.state !== 'PAYMENT_FAILED',
    );
    const activeStates = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'FAILED_DELIVERY'];
    const active = todays
      .filter((o) => activeStates.includes(o.state))
      .concat(recent.filter((o) => activeStates.includes(o.state) && (o.placedAt ?? o.createdAt) < today));
    const names = new Map<string, string>();
    const nameOf = async (id: string) => {
      if (!names.has(id)) names.set(id, (await this.merchants.record(id).catch(() => null))?.name ?? '—');
      return names.get(id)!;
    };
    const rows = [];
    const attention: Array<{
      kind: 'no_rider' | 'eta_breach' | 'auto_paused' | 'delivery_failed';
      orderId: string | null;
      code: string | null;
      merchantName: string;
      minutes: number;
      stage: string | null;
    }> = [];
    for (const o of active) {
      const f = await this.dispatch.fulfilmentForOrder(o.id);
      const row = await this.opsRow(o, f, await nameOf(o.merchantId));
      rows.push(row);
      if (f?.state === 'searching' && now.getTime() - f.requestedAt.getTime() >= 4 * 60_000)
        attention.push({
          kind: 'no_rider',
          orderId: o.id,
          code: o.code,
          merchantName: row.merchantName,
          minutes: Math.floor((now.getTime() - f.requestedAt.getTime()) / 60_000),
          stage: f.fallbackStage,
        });
      // Couldn't deliver (ADR-026): ops retry it or cancel it.
      if (f?.state === 'failed')
        attention.push({
          kind: 'delivery_failed',
          orderId: o.id,
          code: o.code,
          merchantName: row.merchantName,
          minutes: Math.floor((now.getTime() - (f.failedAt ?? now).getTime()) / 60_000),
          stage: o.outcomeReason?.replace(/^delivery_failed_/, '') ?? null,
        });
      if (f?.state !== 'failed' && f?.etaAt && f.etaAt > f.promisedAt)
        attention.push({
          kind: 'eta_breach',
          orderId: o.id,
          code: o.code,
          merchantName: row.merchantName,
          minutes: Math.ceil((f.etaAt.getTime() - f.promisedAt.getTime()) / 60_000),
          stage: null,
        });
    }
    for (const m of await this.merchants.live()) {
      if (!m.acceptingOrders && m.pausedReason === 'missed_orders')
        attention.push({
          kind: 'auto_paused',
          orderId: null,
          code: null,
          merchantName: m.name,
          minutes: m.pausedAt ? Math.floor((now.getTime() - m.pausedAt.getTime()) / 60_000) : 0,
          stage: null,
        });
    }
    const delivered = [];
    for (const o of todays.filter((x) => x.state === 'DELIVERED')) {
      const f = await this.dispatch.fulfilmentForOrder(o.id);
      if (f?.deliveredAt) delivered.push(f.deliveredAt <= f.promisedAt);
    }
    const decided = todays.filter((o) => o.acceptedAt || ['REJECTED', 'EXPIRED'].includes(o.state));
    const accepted = todays.filter((o) => o.acceptedAt && o.placedAt);
    const riders = await this.dispatch.ridersAll();
    const positions = new Map((await this.locations.all(now)).map((p) => [p.riderId, p]));
    const jobs = await this.dispatch.activeAll();
    return {
      at: now.toISOString(),
      kpis: {
        ordersToday: todays.length,
        activeNow: active.length,
        onTimePercent: delivered.length
          ? pct((100 * delivered.filter(Boolean).length) / delivered.length)
          : null,
        fillRatePercent: decided.length
          ? pct((100 * todays.filter((o) => o.acceptedAt).length) / decided.length)
          : null,
        ridersOnline: riders.filter((r) => r.online).length,
        avgAcceptSec: accepted.length
          ? Math.round(
              accepted.reduce((s, o) => s + (o.acceptedAt!.getTime() - o.placedAt!.getTime()) / 1000, 0) /
                accepted.length,
            )
          : null,
      },
      attention: attention.sort((a, b) => b.minutes - a.minutes),
      orders: rows,
      riders: riders.map((r) => ({
        userId: r.userId,
        name: r.name,
        online: r.online,
        lat: positions.get(r.userId)?.lat ?? null,
        lng: positions.get(r.userId)?.lng ?? null,
        activeJobs: jobs.filter((j) => j.riderUserId === r.userId).length,
      })),
    };
  }
}

/** "delivery_failed_no_answer" → "no_answer" (ADR-026). */
export function failedReasonOf(outcome: string | null): (typeof FAILED_REASONS)[number] {
  const r = outcome?.replace(/^delivery_failed_/, '');
  return (FAILED_REASONS as readonly string[]).includes(r ?? '') ? (r as (typeof FAILED_REASONS)[number]) : 'other';
}
