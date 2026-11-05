import type { OpsSupportThreadList } from '@santha/shared-types';
import Link from 'next/link';
import { Card, Chip, PageHeader, tableCls } from '@/components/admin/ui';
import { supportCopy } from '@/i18n/support';
import { dateTime } from '@/lib/format';
import { opsGet, opsLocale } from '@/lib/ops/server';
import { AutoRefresh } from '../live/live-map';

export const metadata = { title: 'Support chat' };
const FILTERS = ['waiting_support', 'waiting_customer', 'resolved', 'mine'] as const;
const TONE = { waiting_support: 'submitted', waiting_customer: 'approved', resolved: 'live' } as const;

/** Support inbox (ADR-028): chats waiting for us first; refreshes itself. */
export default async function SupportInboxPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const locale = await opsLocale();
  const c = supportCopy(locale);
  const raw = (await searchParams).status;
  const filter = (FILTERS as readonly string[]).includes(raw ?? '') ? (raw as (typeof FILTERS)[number]) : 'waiting_support';
  const q = filter === 'mine' ? 'status=waiting_support,waiting_customer&mine=true' : `status=${filter}`;
  const { items } = await opsGet<OpsSupportThreadList>(`/v1/ops/support/threads?${q}`);
  return (
    <>
      <AutoRefresh seconds={20} />
      <PageHeader title={c.title} sub={c.sub} />
      <nav aria-label={c.cols.status} className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/support?status=${f}`}
            aria-current={f === filter ? 'page' : undefined}
            className={`rounded-pill border px-4 py-2 text-sm s-focus ${f === filter ? 'border-indigo bg-indigo text-white' : 'border-indigo-100 bg-white text-indigo hover:bg-sky'}`}
          >
            {c.filters[f]}
          </Link>
        ))}
      </nav>
      <Card>
        {items.length === 0 ? (
          <p className="text-slate">{c.empty}</p>
        ) : (
          <table className={tableCls.table} data-testid="support-inbox">
            <thead>
              <tr>
                {Object.values(c.cols).map((h) => (
                  <th key={h} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} data-testid={`support-${t.id}`}>
                  <td className={`${tableCls.td} text-sm text-slate`}>{dateTime(t.lastMessageAt, locale)}</td>
                  <td className={tableCls.td}>{c.apps[t.app]}</td>
                  <td className={tableCls.td}>{c.topics[t.topic as keyof typeof c.topics] ?? t.topic}</td>
                  <td className={tableCls.td}>{t.orderCode ? `#${t.orderCode}` : '—'}</td>
                  <td className={`${tableCls.td} max-w-md text-sm`}>
                    <Link href={`/admin/support/${t.id}`} className="text-indigo hover:underline s-focus">
                      {t.lastMessagePreview}
                    </Link>
                  </td>
                  <td className={tableCls.td}>
                    <Chip tone={TONE[t.status]}>{c.status[t.status]}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
