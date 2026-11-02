import type { MicroMarketList } from '@santha/shared-types';
import Link from 'next/link';
import { PolygonMap } from '@/components/admin/polygon-map';
import { Card, PageHeader, tableCls } from '@/components/admin/ui';
import { consoleCopy, fill } from '@/i18n/console';
import { dateTime } from '@/lib/format';
import type { Position } from '@/lib/polygon-edit';
import { opsGet, opsLocale, opsSession } from '@/lib/ops/server';

export const metadata = { title: 'Micro-markets' };

export default async function MicroMarketsPage() {
  const [locale, session] = await Promise.all([opsLocale(), opsSession()]);
  const copy = consoleCopy(locale);
  const k = copy.markets;
  const data = await opsGet<MicroMarketList>('/v1/ops/micro-markets');
  const shapes = data.items
    .filter((m) => m.current)
    .map((m) => ({ id: m.id, label: locale === 'te' ? m.nameTe : m.name, ring: m.current!.polygon.coordinates[0] as Position[] }));

  return (
    <>
      <PageHeader
        title={k.title}
        sub={`${copy.nav.city} · ${k.sub}`}
        actions={
          session?.canDecide ? (
            <Link href="/admin/micro-markets/new" className="rounded-md bg-indigo px-6 py-3 font-medium text-white s-focus hover:bg-indigo-700">
              + {k.new}
            </Link>
          ) : null
        }
      />
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card>
          <PolygonMap shapes={shapes} height={520} unavailable={k.mapUnavailable} />
        </Card>
        <Card>
          {data.items.length === 0 ? (
            <p className="text-slate">{k.empty}</p>
          ) : (
            <table className={tableCls.table}>
              <thead>
                <tr>
                  {[k.cols.name, k.cols.version, k.cols.versions, ''].map((h, i) => (
                    <th key={i} scope="col" className={tableCls.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((m) => (
                  <tr key={m.id}>
                    <td className={`${tableCls.td} font-medium`}>
                      {locale === 'te' ? m.nameTe : m.name}
                      <span className="block text-sm font-normal text-slate">{m.slug}</span>
                    </td>
                    <td className={tableCls.td}>
                      {m.current ? fill(k.current, { v: m.current.version, date: dateTime(m.current.effectiveFrom, locale) }) : copy.common.none}
                    </td>
                    <td className={tableCls.td}>{m.versionCount}</td>
                    <td className={`${tableCls.td} text-right`}>
                      <Link href={`/admin/micro-markets/${m.id}`} className="font-medium text-indigo s-focus hover:underline">
                        {copy.common.view}
                      </Link>
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
