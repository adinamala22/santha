import type { OpsOrderList } from '@santha/shared-types';
import Link from 'next/link';
import { Card, Chip, PageHeader, Stat, tableCls } from '@/components/admin/ui';
import { ORDER_FILTERS, type OrderFilter, orderCopy, stateTone } from '@/i18n/orders';
import { dateTime, rupees } from '@/lib/format';
import { opsGet, opsLocale } from '@/lib/ops/server';

export const metadata = { title: 'Orders' };

/** Live orders (M5): filter by state, see who is waiting on whom; open one for its timeline and comms. */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const locale = await opsLocale();
  const o = orderCopy(locale);
  const { filter: raw } = await searchParams;
  const filter: OrderFilter = raw && raw in ORDER_FILTERS ? (raw as OrderFilter) : 'open';
  const states: readonly string[] = ORDER_FILTERS[filter];
  // The newest 200 orders cover a city day at MVP volume; filters and counts are computed from them.
  const all = (await opsGet<OpsOrderList>('/v1/ops/orders?limit=200')).items;
  const items = states.length ? all.filter((x) => states.includes(x.state)) : all;
  const today = new Date().toISOString().slice(0, 10);
  const refundedToday = all.filter((x) => x.createdAt.slice(0, 10) === today).reduce((s, x) => s + x.refundedPaise, 0);
  const open = { items: all };

  return (
    <>
      <PageHeader title={o.title} sub={o.sub} />
      <div className="grid grid-cols-2 gap-6 xl:grid-cols-3">
        <Stat label={o.stats.waiting} value={open.items.filter((x) => x.state === 'PLACED').length} tone="slate" />
        <Stat label={o.stats.preparing} value={open.items.filter((x) => x.state === 'ACCEPTED' || x.state === 'PREPARING').length} tone="leaf" />
        <Stat label={o.stats.refunded} value={rupees(refundedToday)} />
      </div>
      <nav aria-label={o.cols.state} className="my-6 flex flex-wrap gap-2">
        {(Object.keys(ORDER_FILTERS) as OrderFilter[]).map((f) => (
          <Link
            key={f}
            href={`/admin/orders?filter=${f}`}
            aria-current={f === filter ? 'page' : undefined}
            className={`rounded-pill border px-4 py-2 text-sm s-focus ${f === filter ? 'border-indigo bg-indigo text-white' : 'border-indigo-100 bg-white text-indigo hover:bg-sky'}`}
          >
            {o.filters[f]}
          </Link>
        ))}
      </nav>
      <Card>
        {items.length === 0 ? (
          <p className="text-slate">{o.empty}</p>
        ) : (
          <table className={tableCls.table}>
            <thead>
              <tr>
                {Object.values(o.cols).map((h) => (
                  <th key={h} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} data-testid={`order-${x.code}`}>
                  <td className={tableCls.td}>
                    <Link href={`/admin/orders/${x.id}`} className="font-medium text-indigo hover:underline s-focus">
                      #{x.code}
                    </Link>
                  </td>
                  <td className={tableCls.td}>{x.merchantName}</td>
                  <td className={tableCls.td}>
                    <Chip tone={stateTone(x.state)}>{o.states[x.state as keyof typeof o.states] ?? x.state}</Chip>
                  </td>
                  <td className={tableCls.td}>
                    {rupees(x.totalPaise)}
                    {x.refundedPaise > 0 ? <p className="text-xs text-leaf">−{rupees(x.refundedPaise)}</p> : null}
                  </td>
                  <td className={tableCls.td}>{o.payment[x.paymentMethod]}</td>
                  <td className={`${tableCls.td} text-sm text-slate`}>{dateTime(x.placedAt ?? x.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
