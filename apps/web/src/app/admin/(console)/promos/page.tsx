import type { Promo, PromoList } from '@santha/shared-types';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { Card, Chip, PageHeader, Stat, tableCls } from '@/components/admin/ui';
import { consoleCopy, fill } from '@/i18n/console';
import { promoCopy } from '@/i18n/promos';
import { dateTime, rupees, toLocalInput } from '@/lib/format';
import { opsGet, opsLocale, opsSession } from '@/lib/ops/server';
import { createPromo, setPromoActive } from './actions';
import { PromoForm } from './promo-form';

export const metadata = { title: 'Promo codes' };

const STATUS_TONE: Record<Promo['status'], string> = { active: 'live', paused: 'draft', scheduled: 'submitted', expired: 'draft', exhausted: 'failed' };

/** Promo codes with budgets (M4): list with usage, pause/resume, create. Every change is audited. */
export default async function PromosPage() {
  const [locale, session] = await Promise.all([opsLocale(), opsSession()]);
  const copy = consoleCopy(locale);
  const p = promoCopy(locale);
  const errors = { ...copy.errors, ...p.errors };
  const canEdit = !!session?.roles.some((r) => r === 'admin' || r === 'ops' || r === 'finance');
  const canCreate = !!session?.roles.some((r) => r === 'admin' || r === 'finance');
  const { items } = await opsGet<PromoList>('/v1/ops/promos');
  const active = items.filter((x) => x.status === 'active');
  const spent = items.reduce((s, x) => s + x.spentPaise, 0);

  const offer = (x: Promo) =>
    x.kind === 'flat' ? fill(p.offerFlat, { amount: rupees(x.value) }) : fill(p.offerPercent, { pct: x.value, amount: rupees(x.maxDiscountPaise ?? 0) });
  const limits = (x: Promo) =>
    [
      x.minOrderPaise ? fill(p.minOrder, { amount: rupees(x.minOrderPaise) }) : null,
      fill(p.perUser, { n: x.perUserLimit }),
      x.firstOrderOnly ? p.firstOrder : null,
      x.merchantSharePercent ? fill(p.merchantShare, { pct: x.merchantSharePercent }) : null,
      x.merchantTypes.length ? x.merchantTypes.map((t) => p.types[t as keyof typeof p.types] ?? t).join(', ') : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <>
      <PageHeader title={p.title} sub={p.sub} />
      <div className="grid grid-cols-2 gap-6 xl:grid-cols-3">
        <Stat label={p.status.active} value={active.length} tone="leaf" />
        <Stat label={p.cols.budget} value={rupees(spent)} />
        <Stat label={p.status.exhausted} value={items.filter((x) => x.status === 'exhausted').length} tone={items.some((x) => x.status === 'exhausted') ? 'chilli' : 'slate'} />
      </div>

      <div className="mt-8">
        <Card title={p.title}>
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
                  <tr key={x.id} data-testid={`promo-${x.code}`}>
                    <td className={tableCls.td}>
                      <p className="font-medium text-ink">{x.code}</p>
                      <p className="text-sm text-slate">{locale === 'te' ? x.descriptionTe : x.description}</p>
                    </td>
                    <td className={tableCls.td}>{offer(x)}</td>
                    <td className={tableCls.td}>
                      {x.budgetPaise == null ? p.unlimited : fill(p.used, { spent: rupees(x.spentPaise), budget: rupees(x.budgetPaise) })}
                      <p className="text-xs text-slate">{dateTime(x.validFrom, locale)}{x.validTo ? ` → ${dateTime(x.validTo, locale)}` : ''}</p>
                    </td>
                    <td className={`${tableCls.td} text-sm text-slate`}>{limits(x)}</td>
                    <td className={tableCls.td}>
                      <Chip tone={STATUS_TONE[x.status]}>{p.status[x.status]}</Chip>
                    </td>
                    <td className={tableCls.td}>
                      {canEdit ? (
                        <ConfirmAction
                          action={setPromoActive.bind(null, x.id)}
                          choices={
                            x.active
                              ? [{ value: 'pause', label: p.pause, question: fill(p.confirmPause, { code: x.code }), tone: 'danger' }]
                              : [{ value: 'resume', label: p.resume, question: fill(p.confirmResume, { code: x.code }) }]
                          }
                          doneText={{ pause: p.paused, resume: p.resumed }}
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
      </div>

      {canCreate ? (
        <div className="mt-8">
          <Card title={p.create.title}>
            <PromoForm action={createPromo} copy={p} errors={errors} nowLocal={toLocalInput(new Date().toISOString())} />
          </Card>
        </div>
      ) : null}
    </>
  );
}
