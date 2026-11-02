import { Injectable, Logger } from '@nestjs/common';

export interface BarcodeHit {
  barcode: string;
  name: string;
  brand: string | null;
  /** Free-text quantity from the source, e.g. "500 g". */
  quantity: string | null;
  imageUrl: string | null;
  /** Source category tags; mapped to the platform taxonomy by the caller. */
  categories: string[];
}

/**
 * Open-barcode fallback for GTINs missing from the master catalogue (FR-CAT-1). `openfoodfacts`
 * calls the public Open Food Facts API (live only); `mock` (dev/test/fake mode) answers from a
 * small fixed table so the fallback path is exercised without the network.
 */
export abstract class BarcodeLookupProvider {
  abstract readonly name: string;
  abstract lookup(barcode: string): Promise<BarcodeHit | null>;
}

/** Barcodes the mock "knows" (not in the seeded master catalogue). Everything else is a miss. */
export const MOCK_BARCODE_HITS: readonly BarcodeHit[] = [
  { barcode: '8901058000290', name: 'Instant Noodles Masala', brand: 'Demo Foods', quantity: '70 g', imageUrl: null, categories: ['en:instant-noodles'] },
  { barcode: '8901262010016', name: 'Toned Milk Tetra Pack', brand: 'Demo Dairy', quantity: '500 ml', imageUrl: null, categories: ['en:milks'] },
  { barcode: '8906010500016', name: 'Roasted Peanuts Salted', brand: 'Demo Snacks', quantity: '200 g', imageUrl: null, categories: ['en:salty-snacks'] },
];

@Injectable()
export class MockBarcodeLookupProvider extends BarcodeLookupProvider {
  readonly name = 'mock';
  async lookup(barcode: string): Promise<BarcodeHit | null> {
    return MOCK_BARCODE_HITS.find((h) => h.barcode === barcode) ?? null;
  }
}

/** Live Open Food Facts lookup (ODbL data). Never used in dev/test; failures count as a miss. */
@Injectable()
export class OpenFoodFactsProvider extends BarcodeLookupProvider {
  readonly name = 'openfoodfacts';
  private readonly logger = new Logger('OpenFoodFacts');

  async lookup(barcode: string): Promise<BarcodeHit | null> {
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,brands,quantity,image_front_url,categories_tags`, {
        headers: { 'User-Agent': 'Santha/0.1 (ops@santha.app)' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { status?: number; product?: Record<string, unknown> };
      const p = body.product;
      if (body.status !== 1 || !p || typeof p.product_name !== 'string' || !p.product_name.trim()) return null;
      return {
        barcode,
        name: p.product_name.trim(),
        brand: typeof p.brands === 'string' ? (p.brands.split(',')[0]?.trim() ?? null) : null,
        quantity: typeof p.quantity === 'string' ? p.quantity : null,
        imageUrl: typeof p.image_front_url === 'string' ? p.image_front_url : null,
        categories: Array.isArray(p.categories_tags) ? (p.categories_tags as string[]) : [],
      };
    } catch (err) {
      this.logger.warn(`lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
