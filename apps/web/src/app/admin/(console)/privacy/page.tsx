import type { DataRequestList } from '@santha/shared-types';
import Link from 'next/link';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { Card, Chip, PageHeader, tableCls } from '@/components/admin/ui';
import { consoleCopy } from '@/i18n/console';
import { launchCopy } from '@/i18n/launch';
import { dateTime } from '@/lib/format';
import { opsGet, opsLocale } from '@/lib/ops/server';
import { dataRequestAction } from '../reports/actions';

export const metadata = { title: 'Privacy requests' };
const FILTERS = ['open', 'all'] as const;

/** DPDP data-principal requests (M8): correction and erasure need a person; erasure is refused while an order is open. */
export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const locale = await opsLocale();
  const p = launchCopy(locale).privacy;
  const copy = consoleCopy(locale);
  const status = (await searchParams).status === 'all' ? 'all' : 'open';
  const { items } = await opsGet<DataRequestList>(`/v1/ops/data-requests${status === 'open' ? '?status=open' : ''}`);
  return (
    <>
      <PageHeader title={p.title} sub={p.sub} />
      <nav aria-label={p.cols.status} className="mb-6 flex gap-2">
        {FILTERS.map((f) => (
          <Link key={f} href={`/admin/privacy?status=${f}`} aria-current={f === status ? 'page' : undefined} className={`rounded-pill border px-4 py-2 text-sm s-focus ${f === status ? 'border-indigo bg-indigo text-white' : 'border-indigo-100 bg-white text-indigo hover:bg-sky'}`}>
            {p.filters[f]}
          </Link>
        ))}
      </nav>
      <Card>
        {items.length === 0 ? (
          <p className="text-slate">{p.empty}</p>
        ) : (
          <table className={tableCls.table}>
            <thead>
              <tr>
                {Object.values(p.cols).map((h) => (
                  <th key={h} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} data-testid={`request-${x.type}`}>
                  <td className={`${tableCls.td} text-sm text-slate`}>{dateTime(x.createdAt, locale)}</td>
                  <td className={tableCls.td}>{p.types[x.type]}</td>
                  <td className={`${tableCls.td} text-sm`}>{String(x.details ?? '')}</td>
                  <td className={tableCls.td}>
                    <Chip tone={x.status === 'open' ? 'submitted' : x.status === 'completed' ? 'live' : 'draft'}>{p.status[x.status]}</Chip>
                  </td>
                  <td className={tableCls.td}>
                    {x.status === 'open' ? (
                      <ConfirmAction
                        action={dataRequestAction.bind(null, x.id)}
                        choices={[
                          { value: 'complete', label: p.complete, question: x.type === 'erasure' ? p.confirmErase : p.confirmComplete, tone: x.type === 'erasure' ? 'danger' : 'primary' },
                          { value: 'reject', label: p.reject, question: p.confirmReject },
                        ]}
                        noteLabel={p.note}
                        doneText={{ complete: p.completed, reject: p.rejected }}
                        errors={copy.errors}
                        confirmText={copy.common.confirm}
                        cancelText={copy.common.cancel}
                      />
                    ) : null}
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
