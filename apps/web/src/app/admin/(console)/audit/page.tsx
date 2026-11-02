import type { AuditList } from '@santha/shared-types';
import Link from 'next/link';
import { Card, PageHeader, tableCls } from '@/components/admin/ui';
import { consoleCopy } from '@/i18n/console';
import { dateTime } from '@/lib/format';
import { opsGet, opsLocale } from '@/lib/ops/server';

export const metadata = { title: 'Audit log' };

const HREF: Record<string, (id: string) => string> = {
  merchant: (id) => `/admin/merchants/${id}`,
  micro_market: (id) => `/admin/micro-markets/${id}`,
};

/** Every ops mutation (CLAUDE.md: each writes an AuditEvent), newest first. */
export default async function AuditPage() {
  const locale = await opsLocale();
  const copy = consoleCopy(locale);
  const data = await opsGet<AuditList>('/v1/ops/audit?limit=200');
  const actions = copy.merchant.actions as Record<string, string>;

  return (
    <>
      <PageHeader title={copy.audit.title} sub={copy.audit.sub} />
      <Card>
        {data.items.length === 0 ? (
          <p className="text-slate">{copy.audit.empty}</p>
        ) : (
          <table className={tableCls.table}>
            <thead>
              <tr>
                {Object.values(copy.audit.cols).map((h) => (
                  <th key={h} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td className={tableCls.td}>{dateTime(a.createdAt, locale)}</td>
                  <td className={tableCls.td}>
                    {HREF[a.entity] ? (
                      <Link href={HREF[a.entity]!(a.entityId)} className="text-indigo s-focus hover:underline">
                        {a.entity.replace('_', '-')}
                      </Link>
                    ) : (
                      a.entity
                    )}
                    <span className="block font-mono text-xs text-slate">{a.entityId.slice(0, 8)}</span>
                  </td>
                  <td className={tableCls.td}>{actions[a.action] ?? a.action}</td>
                  <td className={`${tableCls.td} font-mono text-xs text-slate`}>{a.actorId?.slice(0, 8) ?? 'system'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
