import { ConfirmAction } from '@/components/admin/confirm-action';
import { consoleCopy, fill } from '@/i18n/console';
import { liveCopy } from '@/i18n/live';
import { resolveFailedDelivery } from './actions';

/** Ops decisions for a delivery that could not be handed over (ADR-026), on the live board and the order page. */
export function FailedDeliveryActions({ orderId, code, locale }: { orderId: string; code: string; locale: 'en' | 'te' }) {
  const c = liveCopy(locale);
  const copy = consoleCopy(locale);
  return (
    <div data-testid={`failed-actions-${code}`}>
      <ConfirmAction
        action={resolveFailedDelivery.bind(null, orderId)}
        choices={[
          { value: 'retry', label: c.failedRetry, question: fill(c.confirmFailedRetry, { code }) },
          { value: 'refund', label: c.failedCancelRefund, question: fill(c.confirmFailedRefund, { code }), tone: 'danger' },
          { value: 'keep', label: c.failedCancelKeep, question: fill(c.confirmFailedKeep, { code }), tone: 'danger' },
        ]}
        noteLabel={c.failedReasonLabel}
        doneText={{ retry: c.failedRetried, cancel: c.failedCancelled }}
        errors={copy.errors}
        confirmText={copy.common.confirm}
        cancelText={copy.common.cancel}
      />
    </div>
  );
}
