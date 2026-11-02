import type { GrievanceList } from '@santha/shared-types';
import Link from 'next/link';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { Card, Chip, PageHeader, tableCls } from '@/components/admin/ui';
import { consoleCopy, fill } from '@/i18n/console';
import { launchCopy } from '@/i18n/launch';
import { dateTime } from '@/lib/format';
import { opsGet, opsLocale } from '@/lib/ops/server';
import { grievanceAction } from '../reports/actions';

export const metadata = { title: 'Grievances' };
const FILTERS = ['open', 'resolved', 'all'] as const;

/** Grievance officer desk (M8): legal clocks, acknowledge, resolve with a note; audited. */
export default async function GrievancesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const locale = await opsLocale();
  const g = launchCopy(locale).grievances;
  const copy = consoleCopy(locale);
  const raw = (await searchParams).status;
  const status = (FILTERS as readonly string[]).includes(raw ?? '') ? (raw as (typeof FILTERS)[number]) : 'open';
  const { items } = await opsGet<GrievanceList>(`/v1/ops/grievances${status === 'all' ? '' : `?status=${status}`}`);
  return (
    <>
      <PageHeader title={g.title} sub={g.sub} />
      <nav aria-label={g.cols.status} className="mb-6 flex gap-2">
        {FILTERS.map((f) => (
          <Link key={f} href={`/admin/grievances?status=${f}`} aria-current={f === status ? 'page' : undefined} className={`rounded-pill border px-4 py-2 text-sm s-focus ${f === status ? 'border-indigo bg-indigo text-white' : 'border-indigo-100 bg-white text-indigo hover:bg-sky'}`}>
            {g.filters[f]}
          </Link>
        ))}
      </nav>
      <Card>
        {items.length === 0 ? (
          <p className="text-slate">{g.empty}</p>
        ) : (
          <table className={tableCls.table}>
            <thead>
              <tr>
                {Object.values(g.cols).map((h) => (
                  <th key={h} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} data-testid={`grievance-${x.id}`}>
                  <td className={`${tableCls.td} text-sm text-slate`}>{dateTime(x.createdAt, locale)}</td>
                  <td className={tableCls.td}>{x.app}</td>
                  <td className={tableCls.td}>{x.category}</td>
                  <td className={`${tableCls.td} max-w-md text-sm`}>{x.description}</td>
                  <td className={`${tableCls.td} text-sm`}>
                    {x.status === 'open' ? fill(g.ackBy, { time: dateTime(x.ackDueAt, locale) }) : x.status === 'acknowledged' ? fill(g.resolveBy, { time: dateTime(x.resolveDueAt, locale) }) : '—'}
                  </td>
                  <td className={tableCls.td}>
                    <Chip tone={x.overdue ? 'failed' : x.status === 'resolved' ? 'live' : 'submitted'}>{x.overdue ? g.overdue : g.status[x.status]}</Chip>
                  </td>
                  <td className={tableCls.td}>
                    {x.status !== 'resolved' ? (
                      <ConfirmAction
                        action={grievanceAction.bind(null, x.id)}
                        choices={[
                          ...(x.status === 'open' ? [{ value: 'ack', label: g.acknowledge, question: g.confirmAck }] : []),
                          { value: 'resolve', label: g.resolve, question: g.confirmResolve },
                        ]}
                        noteLabel={g.resolution}
                        doneText={{ ack: g.acknowledged, resolve: g.resolved }}
                        errors={copy.errors}
                        confirmText={copy.common.confirm}
                        cancelText={copy.common.cancel}
                      />
                    ) : (
                      <p className="text-sm text-slate">{String(x.resolution ?? '')}</p>
                    )}
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
