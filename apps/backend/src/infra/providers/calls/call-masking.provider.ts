/**
 * Number masking (Exotel virtual numbers): customers, couriers and stores call each other through a
 * proxy number bound to the order, so real phone numbers are never shown (architecture: privacy).
 * The mock returns a stable fake proxy per order and party; no calls are placed in dev/test.
 */
export abstract class CallMaskingProvider {
  abstract readonly name: string;
  /** Number `from` dials to reach the other party of this order; valid until delivery + 1 h. */
  abstract proxyNumber(
    orderId: string,
    from: 'customer' | 'courier' | 'store',
    to: 'customer' | 'courier' | 'store',
  ): Promise<string>;
}

export class MockCallMaskingProvider extends CallMaskingProvider {
  readonly name = 'mock';

  async proxyNumber(orderId: string, from: string, to: string): Promise<string> {
    let h = 0;
    for (const ch of `${orderId}:${from}:${to}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `+9180471${String(h % 100000).padStart(5, '0')}`;
  }
}
