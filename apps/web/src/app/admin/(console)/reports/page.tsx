import type { BusinessReport } from '@santha/shared-types';
import { Card, PageHeader, Stat, tableCls } from '@/components/admin/ui';
import { fill } from '@/i18n/console';
import { launchCopy } from '@/i18n/launch';
import { rupees } from '@/lib/format';
import { opsGet, opsLocale } from '@/lib/ops/server';

export const metadata = { title: 'Reports' };

const IST = 330 * 60_000;
const day = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Funnel, on-time, fill rate, contribution per order, merchant health and rider utilisation (M8). */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const locale = await opsLocale();
  const r = launchCopy(locale).reports;
  const q = await searchParams;
  const to = q.to && DATE.test(q.to) ? q.to : day(new Date());
  const from = q.from && DATE.test(q.from) ? q.from : day(new Date(Date.now() - 6 * 86_400_000));
  const rep = await opsGet<BusinessReport>(`/v1/ops/reports?from=${from}&to=${to}`);
  const pct = (v: number | null | undefined) => (v == null ? r.none : `${v}%`);
  const c = rep.contribution;
  return (
    <>
      <PageHeader title={r.title} sub={r.sub} />
      <form className="mb-8 flex flex-wrap items-end gap-4" aria-label={r.show}>
        <label className="text-sm font-medium text-ink">
          {r.from}
          <input type="date" name="from" defaultValue={from} className="mt-1 block h-10 rounded-md border border-indigo-100 bg-white px-3 s-focus" />
        </label>
        <label className="text-sm font-medium text-ink">
          {r.to}
          <input type="date" name="to" defaultValue={to} className="mt-1 block h-10 rounded-md border border-indigo-100 bg-white px-3 s-focus" />
        </label>
        <button type="submit" className="h-10 rounded-pill bg-indigo px-5 font-medium text-white s-focus">
          {r.show}
        </button>
      </form>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
        <Stat label={r.kpis.placed} value={rep.funnel.placed} />
        <Stat label={r.kpis.delivered} value={rep.funnel.delivered} tone="leaf" />
        <Stat label={r.kpis.onTime} value={pct(rep.onTimePercent)} />
        <Stat label={r.kpis.fillRate} value={pct(rep.fillRatePercent)} />
        <Stat label={r.kpis.perOrder} value={c.perOrderPaise == null ? r.none : rupees(Number(c.perOrderPaise))} tone={(c.perOrderPaise ?? 0) < 0 ? 'chilli' : 'slate'} />
        <Stat label={r.kpis.total} value={rupees(c.totalPaise)} />
      </div>
      {rep.funnel.placed === 0 ? <p className="mt-8 text-slate">{r.empty}</p> : null}
      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <Card title={r.funnelTitle}>
          <dl className="grid grid-cols-2 gap-y-2" data-testid="funnel">
            {(Object.keys(r.funnel) as Array<keyof typeof r.funnel>).map((k) => (
              <div key={k} className="contents">
                <dt className="text-slate">{r.funnel[k]}</dt>
                <dd className="text-right font-medium text-ink">{rep.funnel[k]}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title={r.contributionTitle}>
          <dl className="grid grid-cols-2 gap-y-2" data-testid="contribution">
            {(
              [
                ['commission', c.commissionPaise, 1],
                ['fees', c.feesPaise, 1],
                ['riderCost', c.riderCostPaise, -1],
                ['storeCredits', c.storeCreditsPaise, -1],
                ['platformRefunds', c.platformRefundsPaise, -1],
                ['discounts', c.discountsPaise, -1],
                ['total', c.totalPaise, 1],
              ] as const
            ).map(([k, v, sign]) => (
              <div key={k} className="contents">
                <dt className={k === 'total' ? 'font-bold text-ink' : 'text-slate'}>{r.contribution[k]}</dt>
                <dd className={`text-right ${k === 'total' ? 'font-bold' : ''} text-ink`}>{(sign < 0 && v > 0 ? '−' : '') + rupees(v)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
      <div className="mt-8 grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card title={r.merchantsTitle}>
          <table className={tableCls.table}>
            <thead>
              <tr>
                {Object.values(r.mcols).map((h) => (
                  <th key={h} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rep.merchants.map((m) => (
                <tr key={m.merchantId} data-testid={`health-${m.name}`}>
                  <td className={tableCls.td}>{m.name}</td>
                  <td className={tableCls.td}>{m.orders}</td>
                  <td className={tableCls.td}>{pct(m.acceptancePercent as number | null)}</td>
                  <td className={tableCls.td}>{m.avgPrepMin == null ? r.none : fill(r.minutes, { n: Number(m.avgPrepMin) })}</td>
                  <td className={tableCls.td}>{pct(m.issueRatePercent as number | null)}</td>
                  <td className={tableCls.td}>{m.rating == null ? r.none : Number(m.rating).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title={r.ridersTitle}>
          <table className={tableCls.table}>
            <thead>
              <tr>
                {Object.values(r.rcols).map((h) => (
                  <th key={h} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rep.riders.map((x) => (
                <tr key={x.riderUserId}>
                  <td className={tableCls.td}>{x.name}</td>
                  <td className={tableCls.td}>{x.deliveries}</td>
                  <td className={tableCls.td}>{pct(x.onTimePercent as number | null)}</td>
                  <td className={tableCls.td}>{rupees(x.earningsPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
