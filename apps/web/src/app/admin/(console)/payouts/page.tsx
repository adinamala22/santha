import type { PayoutList, ReconList, SettlementRunList } from '@santha/shared-types';
import Link from 'next/link';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { Card, Chip, PageHeader, tableCls } from '@/components/admin/ui';
import { consoleCopy, fill } from '@/i18n/console';
import { moneyCopy } from '@/i18n/money';
import { rupees } from '@/lib/format';
import { opsGet, opsLocale, opsSession } from '@/lib/ops/server';
import { reconcileDay, resolveRecon, retryPayout, runSettlement } from './actions';
import { ReconForm, RunSettlementForm } from './run-forms';

export const metadata = { title: 'Payouts' };

const IST = 330 * 60_000;
const istDate = (iso: string) => new Date(new Date(iso).getTime() + IST).toISOString().slice(0, 10);
const lastDay = (iso: string) => new Date(new Date(iso).getTime() + IST - 1).toISOString().slice(0, 10);
const TONE: Record<string, string> = { transferred: 'live', completed: 'live', pending: 'submitted', running: 'submitted', on_hold: 'draft', failed: 'failed' };

/** Settlement runs, their payouts (CSV, statements, retry) and reconciliation exceptions (M7). */
export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const [locale, session] = await Promise.all([opsLocale(), opsSession()]);
  const m = moneyCopy(locale).payouts;
  const copy = consoleCopy(locale);
  const canRun = !!session?.roles.some((r) => r === 'admin' || r === 'finance');
  const { run: runParam } = await searchParams;
  const [{ items: runs }, { items: recon }] = await Promise.all([opsGet<SettlementRunList>('/v1/ops/settlements'), opsGet<ReconList>('/v1/ops/recon')]);
  const selected = runs.find((r) => r.id === runParam) ?? runs[0];
  const payouts = selected ? (await opsGet<PayoutList>(`/v1/ops/settlements/${selected.id}/payouts`)).items : [];
  const today = new Date(Date.now() + IST).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title={m.title} sub={m.sub} />
      {canRun ? (
        <div className="mb-8">
          <Card title={m.run}>
            <RunSettlementForm action={runSettlement} copy={m} errors={copy.errors} today={today} />
          </Card>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_2fr]">
        <Card title={m.runs}>
          {runs.length === 0 ? (
            <p className="text-slate">{m.noRuns}</p>
          ) : (
            <table className={tableCls.table}>
              <thead>
                <tr>
                  {[m.cols.period, m.cols.kind, m.cols.payouts, m.cols.net].map((h) => (
                    <th key={h} scope="col" className={tableCls.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} data-testid={`run-${r.kind}-${istDate(r.periodStart)}`} className={r.id === selected?.id ? 'bg-sky' : ''}>
                    <td className={tableCls.td}>
                      <Link href={`/admin/payouts?run=${r.id}`} className="text-indigo hover:underline s-focus">
                        {istDate(r.periodStart)}
                        {lastDay(r.periodEnd) !== istDate(r.periodStart) ? ` → ${lastDay(r.periodEnd)}` : ''}
                      </Link>
                    </td>
                    <td className={tableCls.td}>{m.kindName[r.kind]}</td>
                    <td className={tableCls.td}>{r.totals.payouts ?? 0}</td>
                    <td className={tableCls.td}>{rupees(r.totals.netPaise ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          title={m.payoutsTitle}
          aside={
            selected ? (
              <a href={`/admin/payouts/files/settlements/${selected.id}/payouts.csv`} className="text-sm text-indigo hover:underline s-focus">
                {m.csv}
              </a>
            ) : null
          }
        >
          {payouts.length === 0 ? (
            <p className="text-slate">{m.noRuns}</p>
          ) : (
            <table className={tableCls.table}>
              <thead>
                <tr>
                  {Object.values(m.pcols).map((h) => (
                    <th key={h} scope="col" className={tableCls.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} data-testid={`payout-${p.partyName}`}>
                    <td className={tableCls.td}>{p.partyName}</td>
                    <td className={tableCls.td}>{rupees(p.grossPaise)}</td>
                    <td className={`${tableCls.td} text-sm text-slate`}>
                      {rupees(p.tcsPaise)} / {rupees(p.tdsPaise)}
                    </td>
                    <td className={`${tableCls.td} font-medium`}>{rupees(p.netPaise)}</td>
                    <td className={tableCls.td}>
                      <Chip tone={TONE[p.status] ?? 'draft'}>{m.status[p.status]}</Chip>
                    </td>
                    <td className={`${tableCls.td} space-y-2`}>
                      {p.hasStatement ? (
                        <a href={`/admin/payouts/files/payouts/${p.id}/statement.pdf`} className="block text-sm text-indigo hover:underline s-focus">
                          {m.statement}
                        </a>
                      ) : null}
                      {p.status === 'failed' && canRun ? (
                        <ConfirmAction
                          action={retryPayout.bind(null, p.id)}
                          choices={[{ value: 'retry', label: m.retry, question: fill(m.confirmRetry, { amount: rupees(p.netPaise), name: p.partyName }) }]}
                          doneText={{ retry: m.retried }}
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
      </div>

      <div className="mt-8">
        <Card title={m.recon}>
          {canRun ? (
            <div className="mb-6">
              <ReconForm action={reconcileDay} copy={m} errors={copy.errors} today={today} />
            </div>
          ) : null}
          {recon.length === 0 ? (
            <p className="text-slate">{m.reconEmpty}</p>
          ) : (
            <table className={tableCls.table}>
              <thead>
                <tr>
                  {Object.values(m.rcols).map((h) => (
                    <th key={h} scope="col" className={tableCls.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recon.map((x) => (
                  <tr key={x.id} data-testid={`recon-${x.providerPaymentId}`}>
                    <td className={tableCls.td}>{x.reportDate}</td>
                    <td className={tableCls.td}>
                      <Chip tone="failed">{m.reconKinds[x.kind]}</Chip>
                    </td>
                    <td className={`${tableCls.td} font-mono text-sm`}>{x.providerPaymentId}</td>
                    <td className={tableCls.td}>{x.expectedPaise == null ? '—' : rupees(Number(x.expectedPaise))}</td>
                    <td className={tableCls.td}>{x.reportedPaise == null ? '—' : rupees(Number(x.reportedPaise))}</td>
                    <td className={tableCls.td}>
                      <ConfirmAction
                        action={resolveRecon.bind(null, x.id)}
                        choices={[{ value: 'resolve', label: m.resolve, question: m.resolve }]}
                        noteLabel={m.resolveNote}
                        doneText={{ resolve: m.resolved }}
                        errors={copy.errors}
                        confirmText={copy.common.confirm}
                        cancelText={copy.common.cancel}
                      />
                    </td>
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
