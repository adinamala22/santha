/**
 * The order was placed from beyond the store's delivery radius (ADR-022): its bill carries the extra
 * delivery charge. Read from the quote saved with the order, so it never changes after placing.
 */
export function beyondRadius(order: { quote: unknown }): boolean {
  const fees = (order.quote as { bill?: { fees?: Array<{ code: string }> } } | null)?.bill?.fees ?? [];
  return fees.some((f) => f.code === 'beyond_radius');
}
