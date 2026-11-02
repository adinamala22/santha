/**
 * Business reports (M8) — pure aggregation over orders, deliveries, refunds and ratings for a period.
 * The same numbers feed /admin/reports now and the ClickHouse/Metabase dashboards later.
 */

export interface ReportOrder {
  id: string;
  merchantId: string;
  state: string;
  placed: boolean;
  accepted: boolean;
  itemsPaise: number;
  /** Customer fees on the bill (delivery, platform, small-order, packaging), paid to Santha. */
  feesPaise: number;
  discountPaise: number;
  /** Prep time in minutes (accepted → ready), when known. */
  prepMin: number | null;
}

export interface ReportDelivery {
  orderId: string;
  merchantId: string;
  riderUserId: string | null;
  mode: 'self' | 'rider' | 'tpl';
  onTime: boolean;
  riderPayPaise: number;
  /** Delivery fee credited to the store (self) + self-delivery bonus. */
  storeCreditPaise: number;
}

export interface Rates {
  commissionSelfPercent: number;
  commissionRiderPercent: number;
}

export interface Report {
  funnel: { placed: number; accepted: number; delivered: number; cancelled: number; rejected: number; expired: number };
  onTimePercent: number | null;
  fillRatePercent: number | null;
  contribution: { totalPaise: number; perOrderPaise: number | null; commissionPaise: number; feesPaise: number; riderCostPaise: number; storeCreditsPaise: number; platformRefundsPaise: number; discountsPaise: number };
  merchants: Array<{ merchantId: string; orders: number; acceptancePercent: number | null; avgPrepMin: number | null; issueRatePercent: number | null; rating: number | null }>;
  riders: Array<{ riderUserId: string; deliveries: number; onTimePercent: number | null; earningsPaise: number }>;
}

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);

export function buildReport(input: {
  orders: readonly ReportOrder[];
  deliveries: readonly ReportDelivery[];
  /** Refunds Santha bears (late credits, rider issues) in the period. */
  platformRefundsPaise: number;
  issuesByMerchant: ReadonlyMap<string, number>;
  ratingByMerchant: ReadonlyMap<string, number | null>;
  rates: Rates;
}): Report {
  const o = input.orders.filter((x) => x.placed);
  const count = (s: string) => o.filter((x) => x.state === s).length;
  const delivered = input.deliveries;
  const byOrder = new Map(o.map((x) => [x.id, x]));
  let commission = 0;
  let fees = 0;
  let discounts = 0;
  for (const d of delivered) {
    const ord = byOrder.get(d.orderId);
    if (!ord) continue;
    commission += Math.round((ord.itemsPaise * (d.mode === 'self' ? input.rates.commissionSelfPercent : input.rates.commissionRiderPercent)) / 100);
    fees += ord.feesPaise;
    discounts += ord.discountPaise;
  }
  const riderCost = delivered.reduce((s, d) => s + d.riderPayPaise, 0);
  const credits = delivered.reduce((s, d) => s + d.storeCreditPaise, 0);
  const total = commission + fees - riderCost - credits - input.platformRefundsPaise - discounts;
  const decided = o.filter((x) => x.accepted || x.state === 'REJECTED' || x.state === 'EXPIRED');

  const merchantIds = [...new Set(o.map((x) => x.merchantId))];
  const merchants = merchantIds.map((id) => {
    const mo = o.filter((x) => x.merchantId === id);
    const md = mo.filter((x) => x.accepted || x.state === 'REJECTED' || x.state === 'EXPIRED');
    const preps = mo.map((x) => x.prepMin).filter((x): x is number => x != null);
    const dCount = delivered.filter((d) => d.merchantId === id).length;
    return {
      merchantId: id,
      orders: mo.length,
      acceptancePercent: pct(md.filter((x) => x.accepted).length, md.length),
      avgPrepMin: preps.length ? Math.round(preps.reduce((a, b) => a + b, 0) / preps.length) : null,
      issueRatePercent: pct(input.issuesByMerchant.get(id) ?? 0, dCount),
      rating: input.ratingByMerchant.get(id) ?? null,
    };
  });
  const riderIds = [...new Set(delivered.map((d) => d.riderUserId).filter((x): x is string => !!x))];
  const riders = riderIds.map((id) => {
    const rd = delivered.filter((d) => d.riderUserId === id);
    return { riderUserId: id, deliveries: rd.length, onTimePercent: pct(rd.filter((d) => d.onTime).length, rd.length), earningsPaise: rd.reduce((s, d) => s + d.riderPayPaise, 0) };
  });

  return {
    funnel: { placed: o.length, accepted: o.filter((x) => x.accepted).length, delivered: delivered.length, cancelled: count('CANCELLED'), rejected: count('REJECTED'), expired: count('EXPIRED') },
    onTimePercent: pct(delivered.filter((d) => d.onTime).length, delivered.length),
    fillRatePercent: pct(decided.filter((x) => x.accepted).length, decided.length),
    contribution: {
      totalPaise: total,
      perOrderPaise: delivered.length ? Math.round(total / delivered.length) : null,
      commissionPaise: commission,
      feesPaise: fees,
      riderCostPaise: riderCost,
      storeCreditsPaise: credits,
      platformRefundsPaise: input.platformRefundsPaise,
      discountsPaise: discounts,
    },
    merchants: merchants.sort((a, b) => b.orders - a.orders),
    riders: riders.sort((a, b) => b.deliveries - a.deliveries),
  };
}
