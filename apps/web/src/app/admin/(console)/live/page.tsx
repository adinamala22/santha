import type { OpsLive } from '@santha/shared-types';
import Link from 'next/link';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { Card, Chip, PageHeader, Stat, tableCls } from '@/components/admin/ui';
import { consoleCopy, fill } from '@/i18n/console';
import { liveCopy } from '@/i18n/live';
import { orderCopy, stateTone } from '@/i18n/orders';
import { dateTime, rupees } from '@/lib/format';
import { opsGet, opsLocale } from '@/lib/ops/server';
import { forceSelf, reassignOrder } from './actions';
import { AutoRefresh, type LivePoint, LiveMap } from './live-map';
import { FailedDeliveryActions } from './failed-delivery-actions';
import { SosDetails } from './sos-actions';
import { ReassignForm } from './reassign-form';

export const metadata = { title: 'Live orders' };

const time = (iso: string | null, locale: 'en' | 'te') => (iso ? dateTime(iso, locale).split(', ').at(-1)! : '—');

/** Live board (wireframe ops/01-live-orders): KPIs, map, needs-attention, active orders with dispatch overrides. */
export default async function LivePage() {
  const locale = await opsLocale();
  const c = liveCopy(locale);
  const o = orderCopy(locale);
  const copy = consoleCopy(locale);
  const live = await opsGet<OpsLive>('/v1/ops/live');
  const k = live.kpis;
  const ridersOnline = live.riders.filter((r) => r.online);
  const points: LivePoint[] = [
    ...live.riders.filter((r) => r.lat != null && r.lng != null).map((r) => ({ kind: 'rider' as const, lat: r.lat!, lng: r.lng!, label: r.name })),
    ...live.orders.filter((x) => x.store).map((x) => ({ kind: 'store' as const, lat: x.store!.lat, lng: x.store!.lng, label: `#${x.code}` })),
  ];
  const pct = (v: number | null) => (v == null ? c.none : `${v}%`);

  return (
    <>
      <AutoRefresh seconds={15} />
      <PageHeader title={c.title} sub={`${c.sub} · ${c.refreshNote}`} />
      <div className="grid grid-cols-3 gap-4 xl:grid-cols-6">
        <Stat label={c.kpis.ordersToday} value={k.ordersToday} />
        <Stat label={c.kpis.activeNow} value={k.activeNow} />
        <Stat label={c.kpis.onTime} value={pct(k.onTimePercent)} tone="leaf" />
        <Stat label={c.kpis.fillRate} value={pct(k.fillRatePercent)} />
        <Stat label={c.kpis.ridersOnline} value={k.ridersOnline} />
        <Stat label={c.kpis.avgAccept} value={k.avgAcceptSec == null ? c.none : fill(c.seconds, { n: k.avgAcceptSec })} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card title={c.mapTitle} aside={<span className="text-sm text-slate">● {c.legend.rider} · ● {c.legend.store}</span>}>
          <LiveMap points={points} unavailable={c.mapUnavailable} />
        </Card>
        <Card title={c.attentionTitle}>
          {live.attention.length === 0 ? (
            <p className="text-slate">{c.attentionEmpty}</p>
          ) : (
            <ul className="space-y-3" data-testid="attention">
              {live.attention.map((a, i) => (
                <li
                  key={`${a.kind}-${a.sos?.id ?? a.orderId ?? a.merchantName}-${i}`}
                  data-testid={a.sos ? `sos-${a.sos.id}` : undefined}
                  className={`rounded-md p-3 ${a.kind === 'rider_sos' ? 'border-2 border-chilli bg-chilli/10' : a.kind === 'auto_paused' ? 'bg-sky' : 'bg-marigold-100'}`}
                >
                  <p className={a.kind === 'rider_sos' ? 'font-semibold text-chilli' : 'text-ink'}>
                    {fill(c.attention[a.kind], {
                      code: a.code ?? '',
                      min: a.minutes,
                      store: a.merchantName,
                      stage: c.stages[(a.stage ?? 'none') as keyof typeof c.stages] ?? a.stage ?? '',
                      rider: a.sos?.riderName ?? '',
                      order: a.code ? fill(c.sosOrder, { code: a.code }) : '',
                    })}
                  </p>
                  {a.sos ? <SosDetails sos={a.sos} locale={locale} /> : null}
                  {a.orderId ? (
                    <Link href={`/admin/orders/${a.orderId}`} className="text-sm text-indigo hover:underline s-focus">
                      {c.view} ›
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-8">
        <Card title={c.ordersTitle}>
          {live.orders.length === 0 ? (
            <p className="text-slate">{c.ordersEmpty}</p>
          ) : (
            <table className={tableCls.table}>
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
                {live.orders.map((x) => {
                  const movable = x.fulfilmentState === 'searching' || (x.fulfilmentState === 'assigned' && x.mode !== 'self');
                  const late = x.etaAt && x.promisedAt && x.etaAt > x.promisedAt;
                  return (
                    <tr key={x.orderId} data-testid={`live-${x.code}`}>
                      <td className={tableCls.td}>
                        <Link href={`/admin/orders/${x.orderId}`} className="font-medium text-indigo hover:underline s-focus">
                          #{x.code}
                        </Link>
                      </td>
                      <td className={tableCls.td}>{x.merchantName}</td>
                      <td className={tableCls.td}>
                        <Chip tone={stateTone(x.orderState)}>{o.states[x.orderState as keyof typeof o.states] ?? x.orderState}</Chip>
                      </td>
                      <td className={tableCls.td}>
                        {x.mode == null
                          ? c.awaitingStore
                          : `${c.modes[x.mode]} · ${x.fulfilmentState === 'searching' ? fill(c.searching, { sec: x.searchingSec ?? 0 }) : (x.courier ?? '')}`}
                      </td>
                      <td className={`${tableCls.td} ${late ? 'text-chilli' : ''}`}>
                        {time(x.etaAt, locale)} / {time(x.promisedAt, locale)}
                      </td>
                      <td className={tableCls.td}>
                        {o.payment[x.paymentMethod]} {rupees(x.totalPaise)}
                      </td>
                      <td className={`${tableCls.td} space-y-2`}>
                        {x.fulfilmentState === 'failed' ? <FailedDeliveryActions orderId={x.orderId} code={x.code} locale={locale} /> : null}
                        {movable ? (
                          <>
                            <ReassignForm
                              action={reassignOrder.bind(null, x.orderId)}
                              riders={ridersOnline.map((r) => ({ userId: r.userId, name: r.name }))}
                              copy={{
                                reassign: c.reassign,
                                chooseRider: c.chooseRider,
                                noRidersOnline: c.noRidersOnline,
                                confirm: fill(c.confirmReassign, { code: x.code, rider: '{rider}' }),
                                done: c.reassigned,
                                confirmText: copy.common.confirm,
                                cancelText: copy.common.cancel,
                              }}
                              errors={copy.errors}
                            />
                            <ConfirmAction
                              action={forceSelf.bind(null, x.orderId)}
                              choices={[{ value: 'force', label: c.forceSelf, question: fill(c.confirmForceSelf, { code: x.code }) }]}
                              doneText={{ force: c.forcedSelf }}
                              errors={copy.errors}
                              confirmText={copy.common.confirm}
                              cancelText={copy.common.cancel}
                            />
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
