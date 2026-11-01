import type { MerchantView } from '@santha/shared-types';
import Link from 'next/link';
import { Card, Chip, PageHeader, tableCls } from '@/components/admin/ui';
import { consoleCopy, fill } from '@/i18n/console';
import { dateOnly } from '@/lib/format';
import { opsGet, opsLocale } from '@/lib/ops/server';

export const metadata = { title: 'Merchants' };

const FILTERS = ['submitted', 'approved', 'rejected', 'live', 'draft', 'all'] as const;

/** Onboarding queue: oldest submission first (FR-OPS-1). */
export default async function MerchantsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const locale = await opsLocale();
  const copy = consoleCopy(locale);
  const { status: raw } = await searchParams;
  const status = (FILTERS as readonly string[]).includes(raw ?? '') ? (raw as (typeof FILTERS)[number]) : 'submitted';
  const data = await opsGet<{ items: MerchantView[] }>(`/v1/ops/merchants?limit=200${status === 'all' ? '' : `&status=${status}`}`);

  return (
    <>
      <PageHeader title={copy.merchants.title} sub={copy.merchants.sub} />
      <nav aria-label={copy.merchants.cols.status} className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/merchants?status=${f}`}
            aria-current={f === status ? 'page' : undefined}
            className={`rounded-pill border px-4 py-2 text-sm s-focus ${f === status ? 'border-indigo bg-indigo text-white' : 'border-indigo-100 bg-white text-indigo hover:bg-sky'}`}
          >
            {copy.merchants.filters[f]}
          </Link>
        ))}
      </nav>
      <Card>
        {data.items.length === 0 ? (
          <p className="text-slate">{copy.merchants.empty}</p>
        ) : (
          <table className={tableCls.table}>
            <thead>
              <tr>
                {[copy.merchants.cols.store, copy.merchants.cols.type, copy.merchants.cols.market, copy.merchants.cols.status, copy.merchants.cols.submitted, copy.merchants.cols.checks, ''].map((h, i) => (
                  <th key={i} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map(({ merchant: m, microMarket, checklist }) => {
                const done = checklist.filter((c) => c.done).length;
                return (
                  <tr key={m.id}>
                    <td className={`${tableCls.td} font-medium`}>
                      {m.name}
                      {m.nameTe ? (
                        <span lang="te" className="block text-sm font-normal text-slate">
                          {m.nameTe}
                        </span>
                      ) : null}
                    </td>
                    <td className={tableCls.td}>{copy.types[m.type]}</td>
                    <td className={tableCls.td}>{microMarket ? (locale === 'te' ? microMarket.nameTe : microMarket.name) : copy.common.none}</td>
                    <td className={tableCls.td}>
                      <Chip tone={m.status}>{copy.statuses[m.status]}</Chip>
                    </td>
                    <td className={tableCls.td}>{dateOnly(m.submittedAt, locale)}</td>
                    <td className={`${tableCls.td} ${done === checklist.length ? 'text-leaf' : 'text-chilli'}`}>
                      {fill(copy.merchants.checks, { done, total: checklist.length })}
                    </td>
                    <td className={`${tableCls.td} text-right`}>
                      <Link href={`/admin/merchants/${m.id}`} className="font-medium text-indigo s-focus hover:underline">
                        {copy.common.view}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
