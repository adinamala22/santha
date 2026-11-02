import { randomUUID } from 'node:crypto';
import type { LatLng } from '../../../modules/dispatch-tracking/domain/dispatch';

export interface ThreePlRequest {
  orderId: string;
  pickup: LatLng & { name: string };
  drop: LatLng;
  readyAt: Date;
}

export type ThreePlResult =
  { booked: true; ref: string; courierName: string; etaMin: number } | { booked: false; reason: string };

/**
 * Third-party delivery partner, first step of the fallback ladder (architecture: 3PL quote → self-delivery
 * bonus → standby pool → customer notice). Porter / Shadowfax adapters plug in here; dev, tests and fake
 * mode use the mock, whose capacity is set by MOCK_3PL_AVAILABLE.
 */
export abstract class ThreePlProvider {
  abstract readonly name: string;
  abstract book(r: ThreePlRequest): Promise<ThreePlResult>;
  abstract cancel(ref: string): Promise<void>;
}

export class MockThreePlProvider extends ThreePlProvider {
  readonly name = 'mock';
  readonly booked: ThreePlRequest[] = [];
  constructor(public available: boolean) {
    super();
  }

  async book(r: ThreePlRequest): Promise<ThreePlResult> {
    if (!this.available) return { booked: false, reason: 'no_capacity' };
    this.booked.push(r);
    return {
      booked: true,
      ref: `mock3pl_${randomUUID().slice(0, 8)}`,
      courierName: 'Partner courier',
      etaMin: 12,
    };
  }

  async cancel(): Promise<void> {}
}
