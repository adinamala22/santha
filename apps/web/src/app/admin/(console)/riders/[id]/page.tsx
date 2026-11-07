import type { AuditList, OpsRider } from '@santha/shared-types';
import Link from 'next/link';
import { Card, Chip, Notice, PageHeader, tableCls } from '@/components/admin/ui';
import { ConfirmAction, type ConfirmChoice } from '@/components/admin/confirm-action';
import { consoleCopy, fill } from '@/i18n/console';
import { ridersCopy } from '@/i18n/riders';
import { dateOnly, dateTime } from '@/lib/format';
import { opsGet, opsLocale, opsSession } from '@/lib/ops/server';
import { decideRider } from './actions';

export const metadata = { title: 'Rider' };
const TONE = { draft: 'draft', submitted: 'submitted', approved: 'live', rejected: 'rejected', suspended: 'rejected' } as const;

/** One rider (ADR-029): details, sign-up steps, document checks, the decision and its history. */
export default async function RiderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [locale, session] = await Promise.all([opsLocale(), opsSession()]);
  const copy = consoleCopy(locale);
  const mc = copy.merchant;
  const c = ridersCopy(locale);
  const [r, audit] = await Promise.all([opsGet<OpsRider>(`/v1/ops/riders/${id}`), opsGet<AuditList>(`/v1/ops/audit?entity=rider&entityId=${id}`)]);

  const choices: ConfirmChoice[] =
    r.status === 'submitted'
      ? [
          { value: 'approve', label: c.approve, question: fill(c.confirmApprove, { name: r.name }) },
          { value: 'reject', label: c.reject, question: fill(c.confirmReject, { name: r.name }), tone: 'danger' },
        ]
      : r.status === 'approved'
        ? [{ value: 'suspend', label: c.suspend, question: fill(c.confirmSuspend, { name: r.name }), tone: 'danger' }]
        : r.status === 'suspended'
          ? [{ value: 'approve', label: c.lift, question: fill(c.confirmLift, { name: r.name }) }]
          : [];

  const rows: Array<[string, string]> = [
    [c.cols.phone, r.phoneMasked],
    [c.cols.vehicle, c.vehicles[r.vehicle]],
    [c.vehicleNumber, r.vehicleNumber ?? '—'],
    [c.cols.submitted, r.submittedAt ? dateTime(r.submittedAt, locale) : '—'],
    [c.online, r.online ? copy.common.yes : copy.common.no],
    [c.rating, r.rating == null ? '—' : r.rating.toFixed(1)],
  ];

  return (
    <>
      <Link href="/admin/riders" className="text-sm font-medium text-indigo s-focus hover:underline">
        ‹ {c.back}
      </Link>
      <PageHeader title={r.name} sub={r.phoneMasked} actions={<Chip tone={TONE[r.status]}>{c.status[r.status]}</Chip>} />
      {r.statusNote ? (
        <div className="mb-6">
          <Notice tone="error">{fill(c.lastNote, { note: r.statusNote })}</Notice>
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
          </Card>

          <Card title={c.steps}>
            <ul className="space-y-2" data-testid="rider-steps">
              {r.steps.map((s) => (
                <li key={s.key} className="flex items-center justify-between">
                  <span>{c.stepNames[s.key]}</span>
                  <Chip tone={s.done ? 'verified' : 'failed'}>{s.done ? c.done : c.missing}</Chip>
                </li>
              ))}
            </ul>
            {r.vehicle === 'cycle' ? <p className="mt-3 text-sm text-slate">{c.noLicence}</p> : null}
          </Card>

          <Card title={c.checks}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  {Object.values(mc.kycCols).map((h) => (
                    <th key={h} scope="col" className={tableCls.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.checks.map((k) => (
                  <tr key={k.kind} data-testid={`rider-check-${k.kind}`}>
                    <td className={`${tableCls.td} font-medium`}>{mc.kinds[k.kind]}</td>
                    <td className={tableCls.td}>
                      <Chip tone={k.status}>{mc.kycStatus[k.status]}</Chip>
                      {k.failureReason ? <span className="mt-1 block text-sm text-chilli">{k.failureReason}</span> : null}
                    </td>
                    <td className={`${tableCls.td} font-mono text-sm`}>
                      {k.valuePublic ?? k.valueMasked ?? copy.common.none}
                      {typeof k.details?.ifsc === 'string' ? <span className="block text-slate">{k.details.ifsc}</span> : null}
                    </td>
                    <td className={tableCls.td}>{k.nameOnRecord ?? copy.common.none}</td>
                    <td className={tableCls.td}>{dateOnly(k.verifiedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.checks.some((k) => k.kind === 'driving_licence' && k.status === 'pending') ? (
              <div className="mt-4">
                <Notice>{c.licenceReview}</Notice>
              </div>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title={c.decision}>
            {!session?.canDecide ? (
              <Notice>{copy.common.readOnly}</Notice>
            ) : choices.length ? (
              <ConfirmAction
                action={decideRider.bind(null, r.userId)}
                choices={choices}
                noteLabel={r.status === 'suspended' ? c.note : c.reason}
                doneText={{ approve: c.doneMsg, reject: c.doneMsg, suspend: c.doneMsg }}
                errors={copy.errors}
                confirmText={copy.common.confirm}
                cancelText={copy.common.cancel}
              />
            ) : (
              <p className="text-slate">{c.noActions}</p>
            )}
          </Card>

          <Card title={c.history}>
            {audit.items.length ? (
              <ol className="space-y-3">
                {audit.items.map((a) => (
                  <li key={a.id} className="border-l-2 border-indigo-100 pl-4">
                    <p className="font-medium text-ink">{c.status[a.action.replace('rider.', '') as keyof typeof c.status] ?? a.action}</p>
                    <p className="text-sm text-slate">{dateTime(a.createdAt, locale)}</p>
                    {(a.after as { note?: string } | null)?.note ? <p className="text-sm text-ink">{(a.after as { note: string }).note}</p> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-slate">{mc.noHistory}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
