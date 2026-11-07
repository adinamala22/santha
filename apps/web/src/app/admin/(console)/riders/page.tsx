import type { OpsRiderList } from '@santha/shared-types';
import Link from 'next/link';
import { Card, Chip, PageHeader, tableCls } from '@/components/admin/ui';
import { ridersCopy } from '@/i18n/riders';
import { dateTime } from '@/lib/format';
import { opsGet, opsLocale } from '@/lib/ops/server';

export const metadata = { title: 'Riders' };
const FILTERS = ['submitted', 'approved', 'rejected', 'suspended', 'draft'] as const;
const TONE = { draft: 'draft', submitted: 'submitted', approved: 'live', rejected: 'rejected', suspended: 'rejected' } as const;

/** Rider sign-ups (ADR-029): the review queue first, oldest submission at the top. */
export default async function RidersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const locale = await opsLocale();
  const c = ridersCopy(locale);
  const raw = (await searchParams).status;
  const filter = (FILTERS as readonly string[]).includes(raw ?? '') ? (raw as (typeof FILTERS)[number]) : 'submitted';
  const { items } = await opsGet<OpsRiderList>(`/v1/ops/riders?status=${filter}`);
  return (
    <>
      <PageHeader title={c.title} sub={c.sub} />
      <nav aria-label={c.cols.status} className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/riders?status=${f}`}
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
          <table className={tableCls.table} data-testid="riders-table">
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
              {items.map((r) => (
                <tr key={r.userId} data-testid={`rider-${r.userId}`}>
                  <td className={tableCls.td}>
                    <Link href={`/admin/riders/${r.userId}`} className="font-medium text-indigo hover:underline s-focus">
                      {r.name}
                    </Link>
                  </td>
                  <td className={`${tableCls.td} font-mono text-sm`}>{r.phoneMasked}</td>
                  <td className={tableCls.td}>
                    {c.vehicles[r.vehicle]}
                    {r.vehicleNumber ? <span className="block font-mono text-sm text-slate">{r.vehicleNumber}</span> : null}
                  </td>
                  <td className={`${tableCls.td} text-sm text-slate`}>{r.submittedAt ? dateTime(r.submittedAt, locale) : '—'}</td>
                  <td className={tableCls.td}>
                    <Chip tone={TONE[r.status]}>{c.status[r.status]}</Chip>
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
