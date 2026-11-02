import type { MerchantView, MicroMarketList } from '@santha/shared-types';
import Link from 'next/link';
import { Card, PageHeader, Stat } from '@/components/admin/ui';
import { consoleCopy, fill } from '@/i18n/console';
import { redirect } from 'next/navigation';
import { opsGet, opsLocale, opsSession } from '@/lib/ops/server';

export const metadata = { title: 'Overview' };

/** Overview: onboarding funnel and micro-markets. Live orders (mockup) join once ordering exists. */
export default async function Overview() {
  // Finance works in payouts and refunds; the onboarding overview is for ops and admins.
  const session = await opsSession();
  if (session && !session.roles.some((r) => r === 'admin' || r === 'ops')) redirect('/admin/payouts');
  const copy = consoleCopy(await opsLocale());
  const [merchants, markets] = await Promise.all([
    opsGet<{ items: MerchantView[] }>('/v1/ops/merchants?limit=200'),
    opsGet<MicroMarketList>('/v1/ops/micro-markets'),
  ]);
  const by = (s: string) => merchants.items.filter((m) => m.merchant.status === s);
  const waiting = by('submitted');
  const food = waiting.filter((m) => m.merchant.sellsFood || m.merchant.type === 'home_kitchen').length;
  const rejected = by('rejected');

  return (
    <>
      <PageHeader title={copy.overview.title} sub={`${copy.nav.city} · ${copy.overview.sub}`} />
      <div className="grid grid-cols-2 gap-6 xl:grid-cols-4">
        <Stat label={copy.overview.waiting} value={waiting.length} tone={waiting.length ? 'chilli' : 'leaf'} />
        <Stat label={copy.overview.live} value={by('live').length} />
        <Stat label={copy.overview.onboarding} value={by('draft').length + by('approved').length + rejected.length} />
        <Stat label={copy.overview.markets} value={markets.items.length} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <p className="text-slate">{copy.overview.ordersSoon}</p>
        </Card>
        <Card title={copy.overview.attention}>
          <ul className="space-y-4">
            {waiting.length ? (
              <AttentionItem href="/admin/merchants?status=submitted" title={copy.overview.kycQueue} act={copy.overview.act} tone="indigo">
                {fill(copy.overview.kycQueueSub, { n: waiting.length, f: food })}
              </AttentionItem>
            ) : null}
            {rejected.length ? (
              <AttentionItem href="/admin/merchants?status=rejected" title={copy.overview.rejected} act={copy.overview.act} tone="marigold">
                {fill(copy.overview.rejectedSub, { n: rejected.length })}
              </AttentionItem>
            ) : null}
            {!waiting.length && !rejected.length ? <li className="text-slate">{copy.overview.allClear}</li> : null}
          </ul>
        </Card>
      </div>
    </>
  );
}

function AttentionItem({ href, title, act, tone, children }: { href: string; title: string; act: string; tone: 'indigo' | 'marigold'; children: string }) {
  return (
    <li>
      <Link
        href={href}
        className={`flex items-center justify-between rounded-md border border-indigo-100 border-l-4 px-5 py-4 s-focus hover:bg-sky/40 ${tone === 'indigo' ? 'border-l-indigo' : 'border-l-marigold'}`}
      >
        <span>
          <span className="block font-medium text-ink">{title}</span>
          <span className="block text-sm text-slate">{children}</span>
        </span>
        <span className="text-sm font-medium text-indigo">{act} ›</span>
      </Link>
    </li>
  );
}
