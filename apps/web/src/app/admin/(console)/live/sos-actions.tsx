import Link from 'next/link';
import { liveCopy } from '@/i18n/live';

export interface SosInfo {
  id: string;
  riderUserId: string;
  riderName: string;
  lat: number | null;
  lng: number | null;
  called112: boolean;
}

/** Google Maps link for an SOS position (ADR-031). */
export const sosMapUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/**
 * A rider SOS on the live board (ADR-031): where they are, whether they called 112, and the rider page, where ops
 * call them and resolve it. The live board refreshes itself, so the resolve form lives on the rider page.
 */
export function SosDetails({ sos, locale }: { sos: SosInfo; locale: 'en' | 'te' }) {
  const c = liveCopy(locale);
  return (
    <div className="mt-1 space-y-1 text-sm">
      {sos.called112 ? <p className="text-chilli">{c.sosCalled112}</p> : null}
      {sos.lat != null && sos.lng != null ? (
        <a href={sosMapUrl(sos.lat, sos.lng)} target="_blank" rel="noreferrer" className="block text-indigo hover:underline s-focus">
          {c.sosMap} ↗
        </a>
      ) : (
        <p className="text-slate">{c.sosNoLocation}</p>
      )}
      <Link href={`/admin/riders/${sos.riderUserId}#sos`} className="font-medium text-indigo hover:underline s-focus" data-testid={`sos-open-${sos.id}`}>
        {c.sosRider} ›
      </Link>
    </div>
  );
}
