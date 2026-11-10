import type { OpsDeliveryProof, OpsOrderDetail } from '@santha/shared-types';
import Link from 'next/link';
import { Card, Chip, PageHeader, tableCls } from '@/components/admin/ui';
import { fill } from '@/i18n/console';
import { orderCopy, stateTone } from '@/i18n/orders';
import { dateTime, rupees } from '@/lib/format';
import { mediaSrc } from '@/lib/media';
import { opsApi, opsGet, opsLocale } from '@/lib/ops/server';
import { FailedDeliveryActions } from '../../live/failed-delivery-actions';

export const metadata = { title: 'Order' };

/** One order: items (with store changes), state timeline with actors, payment and every message sent. */
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await opsLocale();
  const o = orderCopy(locale);
  const { id } = await params;
  const x = await opsGet<OpsOrderDetail>(`/v1/ops/orders/${id}`);
  const doorRes = await opsApi<OpsDeliveryProof>(`/v1/ops/orders/${id}/delivery-proof`);
  const door = doorRes.ok ? doorRes.data : null;
  const stateLabel = (s: string) => o.states[s as keyof typeof o.states] ?? s;

  return (
    <>
      <p className="mb-4">
        <Link href="/admin/orders" className="text-indigo hover:underline s-focus">
          ← {o.detail.back}
        </Link>
      </p>
      <PageHeader title={`#${x.code}`} sub={`${x.merchantName} · ${rupees(x.totalPaise)} · ${o.payment[x.paymentMethod]}`} actions={<Chip tone={stateTone(x.state)}>{stateLabel(x.state)}</Chip>} />
      {x.refundedPaise > 0 ? <p className="mb-4 text-leaf">{fill(o.detail.refunded, { amount: rupees(x.refundedPaise) })}</p> : null}
      {x.outcomeReason ? <p className="mb-4 text-slate">{fill(o.detail.outcome, { reason: String(x.outcomeReason) })}</p> : null}
      {x.state === 'FAILED_DELIVERY' ? (
        <div className="mb-6 max-w-xl">
          <FailedDeliveryActions orderId={x.id} code={x.code} locale={locale} />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={o.detail.items}>
          <ul className="space-y-2">
            {x.lines.map((l) => (
              <li key={l.variantId} data-testid={`line-${l.variantId}`}>
                <span className={l.status === 'removed' ? 'line-through text-slate' : 'text-ink'}>
                  {l.quantity} × {l.name} ({l.variantLabel}) · {rupees(l.linePaise)}
                </span>
                {l.status === 'removed' ? <span className="ml-2 text-sm text-chilli">{fill(o.detail.removed, { amount: rupees(l.refundPaise) })}</span> : null}
                {l.status === 'substituted' ? (
                  <span className="ml-2 text-sm text-marigold-600">{fill(o.detail.substituted, { name: `${l.substituteName ?? ''} (${l.substituteVariantLabel ?? ''})` })}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-slate">
            {o.detail.address}: {x.address.line}
            {x.address.landmark ? `, ${x.address.landmark}` : ''}
          </p>
          <p className="text-sm text-slate" data-testid="leave-at-door">
            {fill(o.detail.leaveAtDoor, { answer: x.address.leaveAtDoor ? o.detail.yes : o.detail.no })}
          </p>
          {x.instructions ? (
            <p className="text-sm text-slate">
              {o.detail.instructions}: {x.instructions}
            </p>
          ) : null}
          {x.payment ? (
            <p className="mt-2 text-sm text-slate">
              {o.detail.paymentTitle}: {fill(o.detail.paymentLine, { status: x.payment.status, provider: x.payment.provider, amount: rupees(x.payment.amountPaise) })}
              {x.payment.failureReason ? ` · ${x.payment.failureReason}` : ''}
            </p>
          ) : null}
        </Card>

        <Card title={o.detail.door.title}>
          <div data-testid="door-evidence" className="space-y-2 text-sm">
            {!door || !door.state ? (
              <p className="text-slate">{o.detail.door.none}</p>
            ) : (
              <>
                {door.courier ? (
                  <p className="text-ink">
                    {o.detail.door.courier}: {door.courier}
                  </p>
                ) : null}
                {door.arrivedDropAt ? (
                  <p className="text-slate">
                    {o.detail.door.arrived}: {dateTime(door.arrivedDropAt, locale)}
                  </p>
                ) : null}
                {door.deliveredAt ? (
                  <p className="text-slate">
                    {o.detail.door.delivered}: {dateTime(door.deliveredAt, locale)}
                  </p>
                ) : null}
                {door.failedAt ? (
                  <p className="text-chilli">
                    {o.detail.door.failed}: {dateTime(door.failedAt, locale)}
                  </p>
                ) : null}
                {door.waitedMinutes != null ? <p className="text-slate">{fill(o.detail.door.waited, { minutes: String(door.waitedMinutes) })}</p> : null}
                <p className="text-ink" data-testid="door-proof">
                  {o.detail.door.proofLabel}: {o.detail.door.proof[(door.proof ?? 'none') as 'otp' | 'photo' | 'none']}
                </p>
                {door.codCollectedPaise != null ? <p className="text-slate">{fill(o.detail.door.cash, { amount: rupees(door.codCollectedPaise) })}</p> : null}
                {door.proof === 'photo' && door.photoUrl ? (
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element -- private, short-lived link from the API (ADR-033) */}
                    <img data-testid="door-photo" src={mediaSrc(door.photoUrl) ?? door.photoUrl} alt={o.detail.door.photoAlt} className="aspect-[4/3] w-full max-w-sm rounded-md bg-sky object-cover" />
                    <figcaption className="mt-1 text-xs text-slate">{o.detail.door.photoNote}</figcaption>
                  </figure>
                ) : door.proof === 'otp' ? (
                  <p className="text-slate">{o.detail.door.noPhoto}</p>
                ) : null}
              </>
            )}
          </div>
        </Card>

        <Card title={o.detail.timeline}>
          <ol className="space-y-3" aria-label={o.detail.timeline}>
            {x.history.map((h, i) => (
              <li key={`${h.to}-${i}`} className="flex gap-3" data-testid={`step-${h.to}`}>
                <span className="mt-1 h-3 w-3 shrink-0 rounded-pill bg-indigo" aria-hidden />
                <div>
                  <p className="font-medium text-ink">{stateLabel(h.to)}</p>
                  <p className="text-sm text-slate">
                    {dateTime(h.at, locale)} · {o.actors[h.actorType as keyof typeof o.actors] ?? h.actorType}
                    {h.reason ? ` · ${h.reason}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="mt-6">
        <Card title={o.detail.comms}>
          {x.comms.length === 0 ? (
            <p className="text-slate">{o.detail.noComms}</p>
          ) : (
            <table className={tableCls.table}>
              <tbody>
                {x.comms.map((c, i) => (
                  <tr key={`${c.template}-${i}`} data-testid={`comm-${c.channel}-${c.template}`}>
                    <td className={`${tableCls.td} text-sm text-slate`}>{dateTime(c.createdAt, locale)}</td>
                    <td className={tableCls.td}>
                      <Chip tone={c.status === 'failed' ? 'failed' : 'approved'}>{c.channel}</Chip>
                    </td>
                    <td className={`${tableCls.td} text-sm`}>{o.detail.to[c.to]}</td>
                    <td className={tableCls.td}>
                      <p className="text-ink">{c.body}</p>
                      <p className="text-xs text-slate">
                        {c.template} · {c.locale} · {c.provider}
                        {c.error ? ` · ${c.error}` : ''}
                      </p>
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
