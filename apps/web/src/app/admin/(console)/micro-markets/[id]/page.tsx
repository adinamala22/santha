import type { MicroMarketDetail, MicroMarketList } from '@santha/shared-types';
import Link from 'next/link';
import { Card, Chip, Notice, PageHeader } from '@/components/admin/ui';
import { consoleCopy, fill } from '@/i18n/console';
import { dateTime } from '@/lib/format';
import type { Position } from '@/lib/polygon-edit';
import { opsGet, opsLocale, opsSession } from '@/lib/ops/server';
import { VersionEditor } from '../version-editor';

export const metadata = { title: 'Micro-market' };

/** One micro-market: version history (with scheduled versions) and the editor for the next version. */
export default async function MicroMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [locale, session] = await Promise.all([opsLocale(), opsSession()]);
  const copy = consoleCopy(locale);
  const k = copy.markets;
  const [market, all] = await Promise.all([opsGet<MicroMarketDetail>(`/v1/ops/micro-markets/${id}`), opsGet<MicroMarketList>('/v1/ops/micro-markets')]);
  const now = Date.now();
  const latest = market.versions[market.versions.length - 1];
  const scheduled = market.versions.filter((v) => new Date(v.effectiveFrom).getTime() > now);
  const template = latest ?? market.current;
  const neighbours = all.items
    .filter((m) => m.id !== id && m.current)
    .map((m) => ({ id: m.id, label: locale === 'te' ? m.nameTe : m.name, ring: m.current!.polygon.coordinates[0] as Position[] }));

  return (
    <>
      <Link href="/admin/micro-markets" className="text-sm font-medium text-indigo s-focus hover:underline">
        ‹ {copy.common.back}
      </Link>
      <PageHeader
        title={locale === 'te' ? market.nameTe : market.name}
        sub={market.current ? fill(k.current, { v: market.current.version, date: dateTime(market.current.effectiveFrom, locale) }) : undefined}
      />
      {scheduled.map((v) => (
        <div key={v.id} className="mb-4">
          <Notice>{fill(k.scheduled, { v: v.version, date: dateTime(v.effectiveFrom, locale) })}</Notice>
        </div>
      ))}

      <div className="grid gap-6 xl:grid-cols-[3fr_1fr]">
        <Card title={k.publish}>
          <p className="mb-6 text-slate">{k.publishSub}</p>
          {session?.canDecide && template ? (
            <VersionEditor mode="publish" marketId={id} template={template} neighbours={neighbours} copy={copy} />
          ) : (
            <Notice>{copy.common.readOnly}</Notice>
          )}
        </Card>
        <Card title={k.versions}>
          <ol className="space-y-4">
            {[...market.versions].reverse().map((v) => {
              const live = market.current?.id === v.id;
              return (
                <li key={v.id} className="border-l-2 border-indigo-100 pl-4">
                  <p className="flex items-center gap-2 font-medium text-ink">
                    v{v.version} {live ? <Chip tone="live">{copy.statuses.live}</Chip> : null}
                  </p>
                  <p className="text-sm text-slate">
                    {dateTime(v.effectiveFrom, locale)} → {v.effectiveTo ? dateTime(v.effectiveTo, locale) : k.openEnded}
                  </p>
                  {v.note ? <p className="text-sm text-ink">{v.note}</p> : null}
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </>
  );
}
