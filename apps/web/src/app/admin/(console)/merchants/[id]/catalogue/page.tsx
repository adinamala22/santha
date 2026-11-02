import type { CategoryList, ItemPage, MerchantView } from '@santha/shared-types';
import Link from 'next/link';
import { Card, Chip, Notice, PageHeader, tableCls } from '@/components/admin/ui';
import { catalogueCopy } from '@/i18n/catalogue';
import { consoleCopy, fill } from '@/i18n/console';
import { rupees } from '@/lib/format';
import { opsGet, opsLocale, opsSession } from '@/lib/ops/server';
import { assistedCreate, assistedImport } from '../../../catalogue/actions';
import { AssistedImportForm, AssistedItemForm } from './assisted-forms';

export const metadata = { title: 'Merchant catalogue' };

const STATUS_TONE: Record<string, string> = { pending_merchant: 'pending', in_review: 'failed', active: 'live', hidden: 'draft' };

/** Assisted catalogue entry (FR-CAT-3): ops build a merchant's catalogue; items wait for their approval. */
export default async function MerchantCataloguePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [locale, session] = await Promise.all([opsLocale(), opsSession()]);
  const copy = consoleCopy(locale);
  const c = catalogueCopy(locale);
  const errors = { ...copy.errors, ...c.errors };
  const view = await opsGet<MerchantView>(`/v1/ops/merchants/${id}`);
  const m = view.merchant;
  const [page, cats] = await Promise.all([
    opsGet<ItemPage>(`/v1/ops/catalogue/items?merchantId=${id}&limit=200`),
    opsGet<CategoryList>(`/v1/catalogue/categories?type=${m.type}`),
  ]);
  const categories = cats.items.map((x) => ({ slug: x.slug, name: locale === 'te' ? x.nameTe : x.name }));
  const catName = new Map(categories.map((x) => [x.slug, x.name]));

  return (
    <>
      <Link href={`/admin/merchants/${id}`} className="text-sm font-medium text-indigo s-focus hover:underline">
        ‹ {copy.common.back}
      </Link>
      <PageHeader title={fill(c.assisted.title, { store: m.name })} sub={c.assisted.sub} actions={<Chip tone="draft">{fill(c.assisted.count, { n: page.total })}</Chip>} />
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Card>
          {page.items.length ? (
            <table className={tableCls.table}>
              <thead>
                <tr>
                  {Object.values(c.assisted.cols).map((h) => (
                    <th key={h} scope="col" className={tableCls.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.items.map((i) => (
                  <tr key={i.id}>
                    <td className={`${tableCls.td} font-medium`}>
                      {i.name}
                      {i.nameTe ? <span className="block text-sm font-normal text-slate">{i.nameTe}</span> : null}
                    </td>
                    <td className={tableCls.td}>{catName.get(i.categorySlug) ?? i.categorySlug}</td>
                    <td className={tableCls.td}>
                      {i.variants.map((v) => (
                        <span key={v.id} className="block text-sm">
                          {v.label} · {rupees(v.pricePaise)}
                          {v.mrpPaise && v.mrpPaise > v.pricePaise ? <span className="ml-1 text-slate line-through">{rupees(v.mrpPaise)}</span> : null}
                        </span>
                      ))}
                    </td>
                    <td className={tableCls.td}>
                      {c.stock[i.stock]}
                      {i.stale ? <span className="ml-2 text-sm text-chilli">· {c.assisted.stale}</span> : null}
                    </td>
                    <td className={tableCls.td}>
                      <Chip tone={STATUS_TONE[i.status] ?? 'draft'}>{c.status[i.status]}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-slate">{c.assisted.empty}</p>
          )}
        </Card>
        <div className="space-y-6">
          {session?.canDecide ? (
            <>
              <Card title={c.assisted.add}>
                <AssistedItemForm action={assistedCreate.bind(null, id)} copy={c.assisted} categories={categories} errors={errors} sellsFood={m.sellsFood} />
              </Card>
              <Card title={c.assisted.import}>
                <AssistedImportForm action={assistedImport.bind(null, id)} copy={c.assisted} errors={errors} />
              </Card>
            </>
          ) : (
            <Notice>{copy.common.readOnly}</Notice>
          )}
        </div>
      </div>
    </>
  );
}
