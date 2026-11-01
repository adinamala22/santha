import type { MicroMarketList } from '@santha/shared-types';
import Link from 'next/link';
import { Card, Notice, PageHeader } from '@/components/admin/ui';
import { consoleCopy } from '@/i18n/console';
import type { Position } from '@/lib/polygon-edit';
import { opsGet, opsLocale, opsSession } from '@/lib/ops/server';
import { VersionEditor } from '../version-editor';

export const metadata = { title: 'New micro-market' };

/** Create a micro-market (version 1). Fees and rules start from an existing market's current version. */
export default async function NewMicroMarketPage() {
  const [locale, session] = await Promise.all([opsLocale(), opsSession()]);
  const copy = consoleCopy(locale);
  const all = await opsGet<MicroMarketList>('/v1/ops/micro-markets');
  const template = all.items.find((m) => m.current)?.current;
  const neighbours = all.items
    .filter((m) => m.current)
    .map((m) => ({ id: m.id, label: locale === 'te' ? m.nameTe : m.name, ring: m.current!.polygon.coordinates[0] as Position[] }));

  return (
    <>
      <Link href="/admin/micro-markets" className="text-sm font-medium text-indigo s-focus hover:underline">
        ‹ {copy.common.back}
      </Link>
      <PageHeader title={copy.markets.new} sub={copy.markets.publishSub} />
      <Card>
        {session?.canDecide && template ? (
          <VersionEditor mode="create" template={template} neighbours={neighbours} copy={copy} />
        ) : (
          <Notice>{copy.common.readOnly}</Notice>
        )}
      </Card>
    </>
  );
}
