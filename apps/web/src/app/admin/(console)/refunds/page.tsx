import type { OpsIssueList, RefundList } from '@santha/shared-types';
import Link from 'next/link';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { Card, Chip, PageHeader, tableCls } from '@/components/admin/ui';
import { consoleCopy, fill } from '@/i18n/console';
import { moneyCopy } from '@/i18n/money';
import { rupees } from '@/lib/format';
import { opsGet, opsLocale } from '@/lib/ops/server';
import { decideRefund } from '../payouts/actions';

export const metadata = { title: 'Refunds' };

const FILTERS = ['open', 'processed', 'rejected', 'failed', 'all'] as const;
const TONE: Record<string, string> = { pending: 'submitted', awaiting_second: 'submitted', processed: 'live', rejected: 'draft', failed: 'failed' };

/** Refund queue with four-eyes approvals (M7), and open customer issues with trust scores. */
export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const locale = await opsLocale();
  const r = moneyCopy(locale).refunds;
  const copy = consoleCopy(locale);
  const errors = { ...copy.errors, ...r.errors };
  const { status: raw } = await searchParams;
  const status = (FILTERS as readonly string[]).includes(raw ?? '') ? (raw as (typeof FILTERS)[number]) : 'open';
  const [{ items }, { items: issues }] = await Promise.all([opsGet<RefundList>(`/v1/ops/refunds?status=${status}`), opsGet<OpsIssueList>('/v1/ops/issues?status=open')]);

  return (
    <>
      <PageHeader title={r.title} sub={fill(r.sub, { amount: rupees(100_000) })} />
      <nav aria-label={r.cols.status} className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/refunds?status=${f}`}
            aria-current={f === status ? 'page' : undefined}
            className={`rounded-pill border px-4 py-2 text-sm s-focus ${f === status ? 'border-indigo bg-indigo text-white' : 'border-indigo-100 bg-white text-indigo hover:bg-sky'}`}
          >
            {r.filters[f]}
          </Link>
        ))}
      </nav>
      <Card>
        {items.length === 0 ? (
          <p className="text-slate">{r.empty}</p>
        ) : (
          <table className={tableCls.table}>
            <thead>
              <tr>
                {Object.values(r.cols).map((h) => (
                  <th key={h} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} data-testid={`refund-${x.orderCode}-${x.amountPaise}`}>
                  <td className={tableCls.td}>
                    <Link href={`/admin/orders/${x.orderId}`} className="font-medium text-indigo hover:underline s-focus">
                      #{x.orderCode}
                    </Link>
                  </td>
                  <td className={tableCls.td}>{x.merchantName}</td>
                  <td className={tableCls.td}>
                    {rupees(x.amountPaise)}
                    <p className="text-xs text-slate">
                      {r.destination[x.destination]} · {r.liability[x.liability]}
                    </p>
                  </td>
                  <td className={`${tableCls.td} text-sm text-slate`}>{x.reason}</td>
                  <td className={tableCls.td}>{x.approvals.length}</td>
                  <td className={tableCls.td}>
                    <Chip tone={TONE[x.status] ?? 'draft'}>{r.status[x.status]}</Chip>
                    {x.rejectNote ? <p className="text-xs text-slate">{String(x.rejectNote)}</p> : null}
                  </td>
                  <td className={tableCls.td}>
                    {x.status === 'pending' || x.status === 'awaiting_second' ? (
                      <ConfirmAction
                        action={decideRefund.bind(null, x.id)}
                        choices={[
                          { value: 'approve', label: r.approve, question: fill(r.confirmApprove, { amount: rupees(x.amountPaise), code: x.orderCode }) },
                          { value: 'reject', label: r.reject, question: fill(r.confirmReject, { amount: rupees(x.amountPaise), code: x.orderCode }), tone: 'danger' },
                        ]}
                        noteLabel={r.note}
                        doneText={{ approve: r.approved, reject: r.rejected }}
                        errors={errors}
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

      <div className="mt-8">
        <Card title={r.issuesTitle}>
          {issues.length === 0 ? (
            <p className="text-slate">{r.issuesEmpty}</p>
          ) : (
            <table className={tableCls.table}>
              <thead>
                <tr>
                  {Object.values(r.icols).map((h) => (
                    <th key={h} scope="col" className={tableCls.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr key={i.id} data-testid={`issue-${i.type}`}>
                    <td className={tableCls.td}>{r.issueTypes[i.type]}</td>
                    <td className={tableCls.td}>{i.merchantName}</td>
                    <td className={tableCls.td}>{rupees(i.claimedPaise)}</td>
                    <td className={tableCls.td}>{i.trustScore.toFixed(2)}</td>
                    <td className={`${tableCls.td} text-sm text-chilli`}>{i.flags.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
