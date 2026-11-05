import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../analytics-config/domain/micro-market-config';
import { computeQuote, deliveryFee, type FeeCard, type PricedLineInput, type QuoteInput } from './pricing';

const fees: FeeCard = DEFAULT_CONFIG.fees; // ₹25 + ₹8/km, free ≥ ₹199, small-order ₹15 below ₹99, platform ₹5, packaging cap ₹20, GST 18% / 5%

const line = (over: Partial<PricedLineInput> = {}): PricedLineInput => ({
  itemId: 'i1',
  variantId: 'v1',
  name: 'Toor Dal',
  nameTe: null,
  variantLabel: '1 kg',
  quantity: 1,
  unitPricePaise: 16800,
  mrpPaise: 18000,
  stock: 'in',
  stale: false,
  maxPerOrder: null,
  substitution: 'call_me',
  available: true,
  ...over,
});

const input = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  merchant: { id: 'm1', type: 'retail', movPaise: 9900, packagingFeePaise: 0 },
  lines: [line()],
  distanceM: 1500,
  fees,
  promo: null,
  ...over,
});

describe('computeQuote', () => {
  it('retail bill: items GST-inclusive, delivery by distance, platform fee, GST on fees only', () => {
    const q = computeQuote(input());
    expect(q.itemsPaise).toBe(16800);
    expect(q.mrpSavingsPaise).toBe(1200);
    // delivery 2500 + 800 × 1.5 km = 3700; platform 500; no small-order fee (≥ ₹99)
    expect(q.fees).toEqual([
      { code: 'delivery', amountPaise: 3700, waivedPaise: 0 },
      { code: 'platform', amountPaise: 500, waivedPaise: 0 },
    ]);
    expect(q.taxes).toEqual([{ code: 'gst_fees', ratePercent: 18, basePaise: 4200, amountPaise: 756 }]);
    expect(q.totalPaise).toBe(16800 + 4200 + 756);
    expect(q.toFreeDeliveryPaise).toBe(19900 - 16800);
    expect(q.placeable).toBe(true);
  });

  it('free delivery above the threshold (waived amount still shown)', () => {
    const q = computeQuote(input({ lines: [line({ quantity: 2 })] }));
    expect(q.fees[0]).toEqual({ code: 'delivery', amountPaise: 0, waivedPaise: 3700 });
    expect(q.toFreeDeliveryPaise).toBe(0);
    expect(q.totalPaise).toBe(33600 + 500 + 90); // 18% of ₹5 platform fee = 90 paise
  });

  it('small-order fee below the threshold; MOV blocks placing', () => {
    const q = computeQuote(input({ lines: [line({ unitPricePaise: 4000, mrpPaise: null })], merchant: { id: 'm1', type: 'retail', movPaise: 0, packagingFeePaise: 0 } }));
    expect(q.fees.map((f) => f.code)).toEqual(['delivery', 'small_order', 'platform']);
    expect(q.placeable).toBe(true);
    const blocked = computeQuote(input({ lines: [line({ unitPricePaise: 4000 })] }));
    expect(blocked.problems).toEqual([{ code: 'MIN_ORDER_NOT_MET', value: 9900 - 4000 }]);
    expect(blocked.placeable).toBe(false);
  });

  it('home kitchen: packaging capped, 5% GST on food + packaging after discount', () => {
    const q = computeQuote(
      input({
        merchant: { id: 'k1', type: 'home_kitchen', movPaise: 0, packagingFeePaise: 5000 },
        lines: [line({ unitPricePaise: 32000, mrpPaise: null })],
        promo: { code: 'KITCHEN20', discountPaise: 6000, merchantSharePaise: 3000 },
      }),
    );
    expect(q.fees.find((f) => f.code === 'packaging')!.amountPaise).toBe(2000); // capped at ₹20
    const food = q.taxes.find((t) => t.code === 'gst_food')!;
    expect(food).toEqual({ code: 'gst_food', ratePercent: 5, basePaise: 32000 - 6000 + 2000, amountPaise: 1400 });
    expect(q.totalPaise).toBe(q.itemsPaise + q.feesPaise + q.taxPaise - 6000);
  });

  it('discount never exceeds items; merchant share never exceeds discount', () => {
    const q = computeQuote(input({ promo: { code: 'BIG', discountPaise: 99_999, merchantSharePaise: 99_999 } }));
    expect(q.discount).toEqual({ code: 'BIG', discountPaise: 16800, merchantSharePaise: 16800 });
  });

  it('flags unavailable, out-of-stock and over-limit lines and leaves them out of the bill', () => {
    const q = computeQuote(
      input({
        merchant: { id: 'm1', type: 'retail', movPaise: 0, packagingFeePaise: 0 },
        lines: [
          line({ itemId: 'a', variantId: 'a1', available: false }),
          line({ itemId: 'b', variantId: 'b1', stock: 'out' }),
          line({ itemId: 'c', variantId: 'c1', quantity: 2, maxPerOrder: 3 }),
          line({ itemId: 'c', variantId: 'c2', quantity: 2, maxPerOrder: 3 }),
        ],
      }),
    );
    expect(q.problems).toEqual([
      { code: 'ITEM_UNAVAILABLE', itemId: 'a', variantId: 'a1' },
      { code: 'OUT_OF_STOCK', itemId: 'b', variantId: 'b1' },
      { code: 'MAX_PER_ORDER', itemId: 'c', value: 3 },
    ]);
    expect(q.itemsPaise).toBe(4 * 16800);
    expect(q.itemCount).toBe(4);
  });

  it('empty cart has no fees and cannot be placed', () => {
    const q = computeQuote(input({ lines: [] }));
    expect(q).toMatchObject({ fees: [], totalPaise: 0, placeable: false, problems: [{ code: 'EMPTY_CART' }] });
  });

  it('totals always equal lines + fee rows + tax rows − discount (integer paise)', () => {
    for (let n = 1; n <= 40; n++) {
      const q = computeQuote(
        input({
          merchant: { id: 'k', type: n % 2 ? 'home_kitchen' : 'retail', movPaise: 0, packagingFeePaise: n * 37 },
          lines: [line({ unitPricePaise: 1234 * n, quantity: (n % 3) + 1 })],
          distanceM: 333 * n,
          promo: n % 4 ? null : { code: 'X', discountPaise: 777 * n, merchantSharePaise: 100 },
        }),
      );
      const sum = q.lines.reduce((s, l) => s + l.linePaise, 0) + q.fees.reduce((s, f) => s + f.amountPaise, 0) + q.taxes.reduce((s, t) => s + t.amountPaise, 0) - q.discountPaise;
      expect(q.totalPaise).toBe(sum);
      expect(Number.isInteger(q.totalPaise)).toBe(true);
    }
  });
});

describe('deliveryFee', () => {
  it('rounds the per-km part to the paisa', () => {
    expect(deliveryFee(0, 1234, fees).amountPaise).toBe(2500 + 987);
  });
  it('a zero threshold means delivery is never free', () => {
    expect(deliveryFee(10_00_000, 1000, { ...fees, freeDeliveryAbovePaise: 0 }).amountPaise).toBe(3300);
  });
});

describe('beyond the store radius (ADR-022)', () => {
  it('adds the extra delivery charge as its own line; the per-km fee keeps counting; GST applies', () => {
    const near = computeQuote(input({ distanceM: 4000 }));
    const far = computeQuote(input({ distanceM: 7000, beyondRadius: true }));
    expect(near.fees.map((f) => f.code)).not.toContain('beyond_radius');
    expect(far.fees.find((f) => f.code === 'beyond_radius')).toEqual({ code: 'beyond_radius', amountPaise: 3000, waivedPaise: 0 });
    const gst = far.taxes.find((t) => t.code === 'gst_fees')!;
    expect(gst.basePaise).toBe(far.fees.filter((f) => f.code !== 'packaging').reduce((s, f) => s + f.amountPaise, 0));
  });
  it('free delivery never waives it; a zero surcharge (or an old fee card) adds nothing', () => {
    const big = computeQuote(input({ distanceM: 7000, beyondRadius: true, lines: [line({ unitPricePaise: 50_000 })] }));
    expect(big.fees.find((f) => f.code === 'delivery')).toMatchObject({ amountPaise: 0 });
    expect(big.fees.find((f) => f.code === 'beyond_radius')).toMatchObject({ amountPaise: 3000, waivedPaise: 0 });
    expect(computeQuote(input({ beyondRadius: true, fees: { ...fees, beyondRadiusSurchargePaise: 0 } })).fees.map((f) => f.code)).not.toContain('beyond_radius');
    const { beyondRadiusSurchargePaise: _, ...old } = fees;
    expect(computeQuote(input({ beyondRadius: true, fees: old })).fees.map((f) => f.code)).not.toContain('beyond_radius');
  });
});
