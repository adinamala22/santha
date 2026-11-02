'use client';

import { usePathname, useSearchParams } from 'next/navigation';

/** Switches the console between English and Telugu and comes back to the same page. */
export function LangSwitch({ to, label }: { to: 'en' | 'te'; label: string }) {
  const path = usePathname();
  const qs = useSearchParams().toString();
  return (
    <form action="/api/ops/lang" method="post">
      <input type="hidden" name="lang" value={to} />
      <input type="hidden" name="back" value={qs ? `${path}?${qs}` : path} />
      <button type="submit" lang={to} className="px-6 text-marigold s-focus hover:underline">
        {label}
      </button>
    </form>
  );
}
