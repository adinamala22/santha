'use client';

import { consoleMessages } from '@/i18n/console';

/** Error state for console pages (API down, unexpected error). Copy is bilingual since cookies are not readable here. */
export default function ConsoleError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="max-w-xl rounded-lg border border-chilli/30 bg-white p-8 shadow-card">
      <p className="text-ink">{consoleMessages.en.common.loadError}</p>
      <p lang="te" className="mt-2 text-slate">
        {consoleMessages.te.common.loadError}
      </p>
      <button type="button" onClick={reset} className="mt-6 rounded-md bg-indigo px-5 py-3 font-medium text-white s-focus hover:bg-indigo-700">
        {consoleMessages.en.common.retry} · <span lang="te">{consoleMessages.te.common.retry}</span>
      </button>
    </div>
  );
}
