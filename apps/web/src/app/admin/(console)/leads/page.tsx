import type { LeadList } from '@santha/shared-types';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { Card, Chip, PageHeader, tableCls } from '@/components/admin/ui';
import { consoleCopy } from '@/i18n/console';
import { launchCopy } from '@/i18n/launch';
import { dateTime } from '@/lib/format';
import { opsGet, opsLocale } from '@/lib/ops/server';
import { leadAction } from '../reports/actions';

export const metadata = { title: 'Leads' };

/** Website leads (M8): call back, then mark joined or dropped. */
export default async function LeadsPage() {
  const locale = await opsLocale();
  const l = launchCopy(locale).leads;
  const copy = consoleCopy(locale);
  const { items } = await opsGet<LeadList>('/v1/ops/leads');
  return (
    <>
      <PageHeader title={l.title} sub={l.sub} />
      <Card>
        {items.length === 0 ? (
          <p className="text-slate">{l.empty}</p>
        ) : (
          <table className={tableCls.table}>
            <thead>
              <tr>
                {Object.values(l.cols).map((h) => (
                  <th key={h} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} data-testid={`lead-${x.name}`}>
                  <td className={`${tableCls.td} text-sm text-slate`}>{dateTime(x.createdAt, locale)}</td>
                  <td className={tableCls.td}>{l.kinds[x.kind]}</td>
                  <td className={tableCls.td}>{x.name}</td>
                  <td className={`${tableCls.td} font-mono text-sm`}>{x.phone}</td>
                  <td className={tableCls.td}>{String(x.area ?? '—')}</td>
                  <td className={tableCls.td}>
                    <Chip tone={x.status === 'converted' ? 'live' : x.status === 'dropped' ? 'draft' : 'submitted'}>{l.status[x.status]}</Chip>
                  </td>
                  <td className={tableCls.td}>
                    {x.status === 'new' || x.status === 'contacted' ? (
                      <ConfirmAction
                        action={leadAction.bind(null, x.id)}
                        choices={[
                          ...(x.status === 'new' ? [{ value: 'contacted', label: l.contacted, question: l.confirm }] : []),
                          { value: 'converted', label: l.converted, question: l.confirm },
                          { value: 'dropped', label: l.dropped, question: l.confirm, tone: 'danger' as const },
                        ]}
                        doneText={{ contacted: l.updated, converted: l.updated, dropped: l.updated }}
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
