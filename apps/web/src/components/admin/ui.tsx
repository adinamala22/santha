import type { ReactNode } from 'react';

/** Small presentational pieces shared by console pages (tokens only — no ad-hoc colours). */

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-4xl font-bold text-indigo">{title}</h1>
        {sub ? <p className="mt-2 text-lg text-slate">{sub}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, aside, children, className = '' }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-indigo-100 bg-white p-6 shadow-card ${className}`}>
      {title ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-ink">{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, note, tone = 'slate' }: { label: string; value: string | number; note?: string; tone?: 'slate' | 'leaf' | 'chilli' }) {
  const noteCls = tone === 'leaf' ? 'text-leaf' : tone === 'chilli' ? 'text-chilli' : 'text-slate';
  return (
    <div className="rounded-lg border border-indigo-100 bg-white px-6 py-5 shadow-card">
      <p className="text-slate">{label}</p>
      <p className="mt-2 text-4xl font-bold text-indigo">{value}</p>
      {note ? <p className={`mt-1 text-sm ${noteCls}`}>{note}</p> : null}
    </div>
  );
}

const CHIP: Record<string, string> = {
  draft: 'bg-indigo-100 text-slate',
  submitted: 'bg-marigold-100 text-ink',
  approved: 'bg-sky text-indigo',
  rejected: 'bg-chilli/10 text-chilli',
  live: 'bg-eta text-leaf',
  verified: 'bg-eta text-leaf',
  pending: 'bg-marigold-100 text-ink',
  failed: 'bg-chilli/10 text-chilli',
};

export function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-flex rounded-pill px-3 py-1 text-sm font-medium ${CHIP[tone] ?? 'bg-indigo-100 text-indigo'}`}>{children}</span>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const cls = tone === 'error' ? 'border-chilli/30 bg-chilli/10 text-chilli' : tone === 'success' ? 'border-leaf/30 bg-eta text-leaf' : 'border-indigo-100 bg-sky text-indigo';
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-md border px-4 py-3 text-sm ${cls}`}>
      {children}
    </p>
  );
}

export const tableCls = {
  table: 'w-full border-collapse text-left',
  th: 'pb-3 pr-4 text-sm font-medium text-slate',
  td: 'border-t border-indigo-100 py-4 pr-4 align-middle text-ink',
};
