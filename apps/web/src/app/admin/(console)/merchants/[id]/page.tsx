import type { AuditList, MerchantView } from '@santha/shared-types';
import Link from 'next/link';
import { Card, Chip, Notice, PageHeader, tableCls } from '@/components/admin/ui';
import { catalogueCopy } from '@/i18n/catalogue';
import { consoleCopy, fill } from '@/i18n/console';
import { mediaSrc } from '@/lib/media';
import { dateOnly, dateTime, km, rupees } from '@/lib/format';
import { opsGet, opsLocale, opsSession } from '@/lib/ops/server';
import { DecisionPanel } from './decision-panel';
import { HoursForm } from './hours-form';
import { RadiusForm } from './radius-form';

export const metadata = { title: 'Merchant' };

/** Merchant review: details, KYC results, onboarding steps, decision and history (FR-OPS-1). */
export default async function MerchantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [locale, session] = await Promise.all([opsLocale(), opsSession()]);
  const copy = consoleCopy(locale);
  const c = copy.merchant;
  const cc = catalogueCopy(locale);
  const [view, audit] = await Promise.all([
    opsGet<MerchantView>(`/v1/ops/merchants/${id}`),
    opsGet<AuditList>(`/v1/ops/audit?entity=merchant&entityId=${id}`),
  ]);
  const m = view.merchant;
  const marketName = view.microMarket ? (locale === 'te' ? view.microMarket.nameTe : view.microMarket.name) : c.outsideMarkets;
  const firstDay = m.hours ? Object.values(m.hours).find((d) => d.length) : undefined;

  const rows: Array<[string, string]> = [
    [copy.merchants.cols.type, copy.types[m.type] + (m.category ? ` · ${m.category.replace(/_/g, ' ')}` : '')],
    [c.sellsFood, m.sellsFood ? copy.common.yes : copy.common.no],
    [c.address, [m.addressLine, m.landmark, m.pincode].filter(Boolean).join(', ') || copy.common.none],
    [c.location, m.location ? `${marketName} · ${m.location.lat.toFixed(5)}, ${m.location.lng.toFixed(5)}` : copy.common.none],
    [c.radius, km(m.radiusM)],
    [c.mov, rupees(m.movPaise)],
    [c.hours, firstDay ? firstDay.map((r) => `${r.open}–${r.close}`).join(', ') : copy.common.none],
    [c.fulfilment, m.defaultFulfilment === 'self' ? c.fulfilmentSelf : c.fulfilmentRider],
    [c.deliversAnywhere, m.deliversAnywhere ? copy.common.yes : copy.common.no],
  ];
  if (m.type === 'fashion') rows.push([c.returnPolicy, m.returnPolicy ?? copy.common.none]);
  if (m.type === 'home_kitchen') rows.push([c.hygiene, m.hygieneDeclaredAt ? fill(c.declaredOn, { date: dateOnly(m.hygieneDeclaredAt, locale) }) : copy.common.none]);

  return (
    <>
      <Link href="/admin/merchants" className="text-sm font-medium text-indigo s-focus hover:underline">
        ‹ {copy.common.back}
      </Link>
      <PageHeader
        title={m.name}
        sub={[m.nameTe, marketName].filter(Boolean).join(' · ')}
        actions={
          <>
            <Link href={`/admin/merchants/${m.id}/catalogue`} className="rounded-md border border-indigo-100 bg-white px-4 py-2 text-sm font-medium text-indigo s-focus hover:bg-sky">
              {cc.assisted.link}
            </Link>
            <Chip tone={m.status}>{copy.statuses[m.status]}</Chip>
          </>
        }
      />
      {m.status === 'rejected' && m.rejectionCode ? (
        <div className="mb-6">
          <Notice tone="error">
            {fill(c.rejection, { reason: c.reasons[m.rejectionCode as keyof typeof c.reasons] ?? m.rejectionCode })}
            {m.rejectionNote ? ` — ${m.rejectionNote}` : ''}
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card title={c.details}>
            <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-3">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            {m.description ? <p className="mt-4 text-slate">{m.description}</p> : null}
          </Card>

          <Card title={cc.store.photos}>
            {view.photos.length ? (
              <ul className="grid grid-cols-3 gap-4">
                {view.photos.map((p) => {
                  const src = mediaSrc(p.thumbUrl);
                  return (
                    <li key={p.id}>
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element -- uploaded store photo
                        <img src={src} alt={cc.store.photos} className="aspect-square w-full rounded-md bg-sky object-cover" />
                      ) : null}
                      {p.status !== 'approved' ? <p className="mt-1 text-sm text-slate">{p.status === 'rejected' ? cc.photos.rejected : cc.store.pendingPhoto}</p> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-slate">{cc.store.noPhotos}</p>
            )}
          </Card>

          <Card title={c.kyc}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  {Object.values(c.kycCols).map((h) => (
                    <th key={h} scope="col" className={tableCls.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.kyc.map((k) => (
                  <tr key={k.kind}>
                    <td className={`${tableCls.td} font-medium`}>{c.kinds[k.kind]}</td>
                    <td className={tableCls.td}>
                      <Chip tone={k.status}>{c.kycStatus[k.status]}</Chip>
                      {k.failureReason ? <span className="mt-1 block text-sm text-chilli">{k.failureReason}</span> : null}
                    </td>
                    <td className={`${tableCls.td} font-mono text-sm`}>
                      {k.valuePublic ?? k.valueMasked ?? (typeof k.details?.reason === 'string' ? k.details.reason : copy.common.none)}
                      {typeof k.details?.ifsc === 'string' ? <span className="block text-slate">{k.details.ifsc}</span> : null}
                    </td>
                    <td className={tableCls.td}>{k.nameOnRecord ?? copy.common.none}</td>
                    <td className={tableCls.td}>{dateOnly(k.verifiedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {view.kyc.some((k) => k.provider === 'manual') ? (
              <div className="mt-4" data-testid="manual-kyc-note">
                <Notice>{c.manualKyc}</Notice>
              </div>
            ) : null}
            {view.kyc.some((k) => k.kind === 'drug_licence' && k.status === 'pending') ? (
              <div className="mt-4">
                <Notice>{c.drugLicenceReview}</Notice>
              </div>
            ) : null}
          </Card>

          <Card title={c.staff}>
            {view.staff.length ? (
              <ul className="space-y-2">
                {view.staff.map((s) => (
                  <li key={s.id} className="flex justify-between">
                    <span>{s.name}</span>
                    <span className="font-mono text-sm text-slate">{s.phoneMasked}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate">{c.noStaff}</p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title={c.checklist}>
            <ul className="space-y-2">
              {view.checklist.map((s) => (
                <li key={s.key} className="flex items-center gap-3">
                  <span aria-hidden className={`inline-block h-5 w-5 rounded-pill text-center text-xs leading-5 ${s.done ? 'bg-leaf text-white' : 'bg-chilli/10 text-chilli'}`}>
                    {s.done ? '✓' : '!'}
                  </span>
                  <span className={s.done ? 'text-ink' : 'text-chilli'}>
                    {c.steps[s.key as keyof typeof c.steps] ?? s.key}
                    <span className="sr-only">{s.done ? ` — ${copy.common.yes}` : ` — ${copy.common.no}`}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={c.decision}>
            <DecisionPanel id={m.id} name={m.name} market={marketName} status={m.status} canDecide={!!session?.canDecide} copy={copy} />
          </Card>

          <Card title={c.hoursEdit.title}>
            <HoursForm id={m.id} hours={m.hours} openNow={m.status === 'live' ? view.openNow.open : null} canEdit={!!session?.canDecide} copy={copy} />
          </Card>

          <Card title={c.radiusEdit.title}>
            <RadiusForm id={m.id} radiusM={m.radiusM} canEdit={!!session?.canDecide} copy={copy} />
          </Card>

          <Card title={c.history}>
            {audit.items.length ? (
              <ol className="space-y-3">
                {audit.items.map((a) => (
                  <li key={a.id} className="border-l-2 border-indigo-100 pl-4">
                    <p className="font-medium text-ink">{c.actions[a.action as keyof typeof c.actions] ?? a.action}</p>
                    <p className="text-sm text-slate">{dateTime(a.createdAt, locale)}</p>
                    {(a.after as { note?: string } | null)?.note ? <p className="text-sm text-ink">{(a.after as { note: string }).note}</p> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-slate">{c.noHistory}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
