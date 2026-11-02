import type { DisputeList } from '@santha/shared-types';
import Link from 'next/link';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { Card, Chip, PageHeader, tableCls } from '@/components/admin/ui';
import { consoleCopy, fill } from '@/i18n/console';
import { moneyCopy } from '@/i18n/money';
import { dateTime, rupees } from '@/lib/format';
import { opsGet, opsLocale } from '@/lib/ops/server';
import { decideDispute } from '../payouts/actions';

export const metadata = { title: 'Disputes' };

const FILTERS = ['open', 'accepted', 'rejected', 'all'] as const;
const TONE: Record<string, string> = { open: 'submitted', accepted: 'live', rejected: 'draft' };

/** Store disputes on refunds charged to them (M7): accept (credited next payout) or reject, audited. */
export default async function DisputesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const locale = await opsLocale();
  const d = moneyCopy(locale).disputes;
  const copy = consoleCopy(locale);
  const { status: raw } = await searchParams;
  const status = (FILTERS as readonly string[]).includes(raw ?? '') ? (raw as (typeof FILTERS)[number]) : 'open';
  const { items } = await opsGet<DisputeList>(`/v1/ops/disputes?status=${status}`);
  return (
    <>
      <PageHeader title={d.title} sub={d.sub} />
      <nav aria-label={d.cols.status} className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/disputes?status=${f}`}
            aria-current={f === status ? 'page' : undefined}
            className={`rounded-pill border px-4 py-2 text-sm s-focus ${f === status ? 'border-indigo bg-indigo text-white' : 'border-indigo-100 bg-white text-indigo hover:bg-sky'}`}
          >
            {d.filters[f]}
          </Link>
        ))}
      </nav>
      <Card>
        {items.length === 0 ? (
          <p className="text-slate">{d.empty}</p>
        ) : (
          <table className={tableCls.table}>
            <thead>
              <tr>
                {Object.values(d.cols).map((h) => (
                  <th key={h} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} data-testid={`dispute-${x.id}`}>
                  <td className={tableCls.td}>{x.merchantName}</td>
                  <td className={`${tableCls.td} max-w-md text-sm`}>{x.reason}</td>
                  <td className={`${tableCls.td} text-sm text-slate`}>{dateTime(x.createdAt, locale)}</td>
                  <td className={tableCls.td}>
                    <Chip tone={TONE[x.status] ?? 'draft'}>{d.status[x.status]}</Chip>
                    {x.adjustmentPaise > 0 ? <p className="text-xs text-leaf">{fill(d.credited, { amount: rupees(x.adjustmentPaise) })}</p> : null}
                  </td>
                  <td className={tableCls.td}>
                    {x.status === 'open' ? (
                      <ConfirmAction
                        action={decideDispute.bind(null, x.id)}
                        choices={[
                          { value: 'accept', label: d.accept, question: d.confirmAccept },
                          { value: 'reject', label: d.reject, question: d.confirmReject, tone: 'danger' },
                        ]}
                        noteLabel={d.note}
                        doneText={{ accept: d.accepted, reject: d.rejected }}
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
