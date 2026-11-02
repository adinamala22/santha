import type { ReviewList } from '@santha/shared-types';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { Card, PageHeader, tableCls } from '@/components/admin/ui';
import { consoleCopy } from '@/i18n/console';
import { launchCopy } from '@/i18n/launch';
import { opsGet, opsLocale } from '@/lib/ops/server';
import { reviewAction } from '../reports/actions';

export const metadata = { title: 'Reviews' };

/** Review moderation queue (M8): comments the screen held; publish or hide (audited). */
export default async function ReviewsPage() {
  const locale = await opsLocale();
  const r = launchCopy(locale).reviews;
  const copy = consoleCopy(locale);
  const { items } = await opsGet<ReviewList>('/v1/ops/reviews');
  return (
    <>
      <PageHeader title={r.title} sub={r.sub} />
      <Card>
        {items.length === 0 ? (
          <p className="text-slate">{r.empty}</p>
        ) : (
          <table className={tableCls.table}>
            <thead>
              <tr>
                {Object.values(r.cols).map((h) => (
                  <th key={h} scope="col" className={tableCls.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.orderId} data-testid={`review-${x.orderId}`}>
                  <td className={tableCls.td}>{'★'.repeat(x.storeStars)}</td>
                  <td className={`${tableCls.td} max-w-lg`}>{String(x.comment ?? '')}</td>
                  <td className={`${tableCls.td} text-sm text-chilli`}>
                    {String(x.flagReason ?? '')
                      .split(',')
                      .map((k) => r.reasons[k as keyof typeof r.reasons] ?? k)
                      .join(', ')}
                  </td>
                  <td className={tableCls.td}>
                    <ConfirmAction
                      action={reviewAction.bind(null, x.orderId)}
                      choices={[
                        { value: 'publish', label: r.publish, question: r.confirmPublish },
                        { value: 'hide', label: r.hide, question: r.confirmHide, tone: 'danger' },
                      ]}
                      doneText={{ publish: r.published, hide: r.hidden }}
                      errors={copy.errors}
                      confirmText={copy.common.confirm}
                      cancelText={copy.common.cancel}
                    />
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
