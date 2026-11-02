import type { Metadata } from 'next';
import { StaffDelivery } from './staff-delivery';

export const metadata: Metadata = { title: 'Santha delivery', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/** Staff delivery link sent by SMS when a store delivers itself (M6). Public; the token is the credential. */
export default async function StaffDeliveryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <StaffDelivery token={token} />;
}
