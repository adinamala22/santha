import type { BarcodeRequestList, CategoryList, ItemPage, MediaList, MerchantView, QaSummary } from '@santha/shared-types';
import Link from 'next/link';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { Card, Chip, PageHeader, Stat, tableCls } from '@/components/admin/ui';
import { catalogueCopy } from '@/i18n/catalogue';
import { consoleCopy, fill } from '@/i18n/console';
import { dateOnly, dateTime, rupees } from '@/lib/format';
import { mediaSrc } from '@/lib/media';
import { opsGet, opsLocale, opsSession } from '@/lib/ops/server';
import { enrichBarcode, reviewItem, reviewMedia } from './actions';
import { EnrichForm } from './enrich-form';

export const metadata = { title: 'Catalogue QA' };

const TABS = ['held', 'photos', 'barcodes'] as const;
type Tab = (typeof TABS)[number];

/** Catalogue QA (FR-OPS-1, FR-CAT-1/7): held items, photo moderation, unknown-barcode enrichment. */
export default async function CataloguePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'held';
  const [locale, session] = await Promise.all([opsLocale(), opsSession()]);
  const copy = consoleCopy(locale);
  const c = catalogueCopy(locale);
  const errors = { ...copy.errors, ...c.errors };
  const canDecide = !!session?.canDecide;

  const [summary, merchants] = await Promise.all([
    opsGet<QaSummary>('/v1/ops/catalogue/summary'),
    opsGet<{ items: MerchantView[] }>('/v1/ops/merchants?limit=200'),
  ]);
  const storeName = new Map(merchants.items.map((m) => [m.merchant.id, m.merchant.name]));
  const counts: Record<Tab, number> = { held: summary.heldItems, photos: summary.photosToReview, barcodes: summary.barcodeRequests };

  return (
    <>
      <PageHeader title={c.title} sub={c.sub} />
      <div className="grid grid-cols-2 gap-6 xl:grid-cols-4">
        <Stat label={c.summary.held} value={summary.heldItems} tone={summary.heldItems ? 'chilli' : 'leaf'} />
        <Stat label={c.summary.photos} value={summary.photosToReview} />
        <Stat label={c.summary.barcodes} value={summary.barcodeRequests} />
        <Stat label={c.summary.stale} value={summary.staleItems} note={c.summary.staleNote} tone={summary.staleItems ? 'chilli' : 'slate'} />
      </div>

      <nav aria-label={c.title} className="mt-8 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/admin/catalogue?tab=${t}`}
            aria-current={t === tab ? 'page' : undefined}
            className={`rounded-pill px-4 py-2 text-sm font-medium s-focus ${t === tab ? 'bg-indigo text-white' : 'bg-white text-indigo hover:bg-sky'}`}
          >
            {c.tabs[t]} · {counts[t]}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === 'held' ? <Held c={c} copy={copy} errors={errors} canDecide={canDecide} storeName={storeName} /> : null}
        {tab === 'photos' ? <Photos c={c} copy={copy} errors={errors} canDecide={canDecide} storeName={storeName} locale={locale} /> : null}
        {tab === 'barcodes' ? <Barcodes c={c} copy={copy} errors={errors} canDecide={canDecide} locale={locale} /> : null}
      </div>
    </>
  );
}

type Copy = ReturnType<typeof catalogueCopy>;
type Common = ReturnType<typeof consoleCopy>;

async function Held({ c, copy, errors, canDecide, storeName }: { c: Copy; copy: Common; errors: Record<string, string>; canDecide: boolean; storeName: Map<string, string> }) {
  const page = await opsGet<ItemPage>('/v1/ops/catalogue/items?status=in_review&limit=100');
  if (!page.items.length) return <Card><p className="text-slate">{c.held.empty}</p></Card>;
  return (
    <Card>
      <table className={tableCls.table}>
        <thead>
          <tr>
            {Object.values(c.held.cols).map((h) => (
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
                {i.nameTe ? <span className="block text-sm text-slate">{i.nameTe}</span> : null}
              </td>
              <td className={tableCls.td}>
                <Link href={`/admin/merchants/${i.merchantId}`} className="text-indigo s-focus hover:underline">
                  {storeName.get(i.merchantId) ?? i.merchantId.slice(0, 8)}
                </Link>
              </td>
              <td className={`${tableCls.td} text-sm text-chilli`}>{i.reviewReason}</td>
              <td className={tableCls.td}>{rupees(Math.min(...i.variants.map((v) => v.pricePaise)))}</td>
              <td className={`${tableCls.td} w-80`}>
                {canDecide ? (
                  <ConfirmAction
                    action={reviewItem.bind(null, i.id)}
                    choices={[
                      { value: 'release', label: c.held.release, question: fill(c.held.confirmRelease, { name: i.name }) },
                      { value: 'reject', label: c.held.reject, question: fill(c.held.confirmReject, { name: i.name }), tone: 'danger' },
                    ]}
                    noteLabel={c.held.note}
                    doneText={{ release: c.held.released, reject: c.held.rejected }}
                    errors={errors}
                    confirmText={copy.common.confirm}
                    cancelText={copy.common.cancel}
                  />
                ) : (
                  <span className="text-sm text-slate">{copy.common.readOnly}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function Photos({ c, copy, errors, canDecide, storeName, locale }: { c: Copy; copy: Common; errors: Record<string, string>; canDecide: boolean; storeName: Map<string, string>; locale: 'en' | 'te' }) {
  const list = await opsGet<MediaList>('/v1/ops/catalogue/media');
  if (!list.items.length) return <Card><p className="text-slate">{c.photos.empty}</p></Card>;
  return (
    <ul className="grid grid-cols-2 gap-6 xl:grid-cols-4">
      {list.items.map((m) => {
        const kind = m.purpose === 'store' ? c.photos.store : c.photos.item;
        const src = mediaSrc(m.mediumUrl ?? m.thumbUrl);
        return (
          <li key={m.id} className="overflow-hidden rounded-lg border border-indigo-100 bg-white shadow-card">
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element -- moderation preview of an arbitrary uploaded image
              <img src={src} alt={fill(c.photos.alt, { kind })} className="aspect-[4/3] w-full bg-sky object-cover" />
            ) : (
              <div className="aspect-[4/3] w-full bg-sky" />
            )}
            <div className="space-y-2 p-4">
              <p className="font-medium text-ink">
                {kind} · {storeName.get(m.merchantId) ?? m.merchantId.slice(0, 8)}
              </p>
              <p className="text-sm text-slate">{fill(c.photos.uploaded, { date: dateTime(m.createdAt, locale) })}</p>
              {canDecide ? (
                <ConfirmAction
                  action={reviewMedia.bind(null, m.id)}
                  choices={[
                    { value: 'approve', label: c.photos.approve, question: `${c.photos.approve}?` },
                    { value: 'reject', label: c.photos.reject, question: `${c.photos.reject}?`, tone: 'danger' },
                  ]}
                  noteLabel={c.photos.reason}
                  doneText={{ approve: c.photos.approved, reject: c.photos.rejected }}
                  errors={errors}
                  confirmText={copy.common.confirm}
                  cancelText={copy.common.cancel}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

async function Barcodes({ c, copy, errors, canDecide, locale }: { c: Copy; copy: Common; errors: Record<string, string>; canDecide: boolean; locale: 'en' | 'te' }) {
  const [list, ...cats] = await Promise.all([
    opsGet<BarcodeRequestList>('/v1/ops/catalogue/barcode-requests'),
    ...(['retail', 'home_business'] as const).map((t) => opsGet<CategoryList>(`/v1/catalogue/categories?type=${t}`)),
  ]);
  const categories = [...new Map(cats.flatMap((x) => x.items).map((x) => [x.slug, { slug: x.slug, name: locale === 'te' ? x.nameTe : x.name }])).values()];
  if (!list.items.length) return <Card><p className="text-slate">{c.barcodes.empty}</p></Card>;
  return (
    <Card>
      <table className={tableCls.table}>
        <thead>
          <tr>
            {Object.values(c.barcodes.cols).map((h) => (
              <th key={h} scope="col" className={tableCls.th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.items.map((r) => (
            <tr key={r.barcode}>
              <td className={`${tableCls.td} font-mono`}>{r.barcode}</td>
              <td className={tableCls.td}>
                <Chip tone={r.scanCount > 1 ? 'pending' : 'draft'}>{r.scanCount}</Chip>
              </td>
              <td className={tableCls.td}>{dateOnly(r.createdAt, locale)}</td>
              <td className={`${tableCls.td} w-[28rem]`}>
                {canDecide ? (
                  <EnrichForm action={enrichBarcode.bind(null, r.barcode)} copy={{ ...c.barcodes, added: fill(c.barcodes.added, { barcode: r.barcode }) }} categories={categories} errors={errors} />
                ) : (
                  <span className="text-sm text-slate">{copy.common.readOnly}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
