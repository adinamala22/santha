import type { OpsSupportThread } from '@santha/shared-types';
import Link from 'next/link';
import { ConfirmAction } from '@/components/admin/confirm-action';
import { Card, Chip, PageHeader } from '@/components/admin/ui';
import { consoleCopy, fill } from '@/i18n/console';
import { supportCopy } from '@/i18n/support';
import { dateTime } from '@/lib/format';
import { opsGet, opsLocale, opsSession } from '@/lib/ops/server';
import { chatDecision, replyToChat } from '../actions';
import { ReplyForm } from '../reply-form';

export const metadata = { title: 'Support chat' };
const TONE = { waiting_support: 'submitted', waiting_customer: 'approved', resolved: 'live' } as const;

/** One support chat (ADR-028): the conversation, who asked (masked phone), the order, reply / assign / resolve. */
export default async function SupportThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const [locale, session] = await Promise.all([opsLocale(), opsSession()]);
  const c = supportCopy(locale);
  const copy = consoleCopy(locale);
  const { id } = await params;
  const t = await opsGet<OpsSupportThread>(`/v1/ops/support/threads/${id}`);
  const topic = c.topics[t.topic as keyof typeof c.topics] ?? t.topic;
  const who = [c.apps[t.app], t.requester.name].filter(Boolean).join(' · ');
  const assignee = t.assigneeId == null ? c.unassigned : fill(c.assignee, { who: t.assigneeId === session?.userId ? c.me : c.someone });
  return (
    <>
      <p className="mb-4">
        <Link href="/admin/support" className="text-indigo hover:underline s-focus">
          ← {c.back}
        </Link>
      </p>
      <PageHeader title={topic} sub={fill(c.requester, { who, phone: t.requester.phoneMasked })} actions={<Chip tone={TONE[t.status]}>{c.status[t.status]}</Chip>} />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <ol className="space-y-3" aria-label={c.title} data-testid="support-messages">
            {t.messages.map((m) => (
              <li key={m.id} className={`flex ${m.author === 'support' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-4 py-3 ${m.author === 'support' ? 'bg-indigo text-white' : 'bg-sky text-ink'}`}>
                  <p className="text-xs font-semibold opacity-80">{m.author === 'support' ? c.you : c.them}</p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className="mt-1 text-xs opacity-70">{dateTime(m.createdAt, locale)}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-6 border-t border-indigo-100 pt-6">
            <ReplyForm
              action={replyToChat.bind(null, t.id)}
              macros={c.macros}
              copy={{ replyLabel: c.replyLabel, replyHint: c.replyHint, macroLabel: c.macroLabel, macroNone: c.macroNone, send: c.send, sent: c.sent }}
              errors={copy.errors}
            />
          </div>
        </Card>
        <Card>
          <div className="space-y-4">
            {t.orderId && t.orderCode ? (
              <p>
                <Link href={`/admin/orders/${t.orderId}`} className="font-medium text-indigo hover:underline s-focus">
                  {fill(c.viewOrder, { code: t.orderCode })} ›
                </Link>
              </p>
            ) : null}
            <p className="text-sm text-slate" data-testid="support-assignee">
              {assignee}
            </p>
            {t.status !== 'resolved' ? (
              <ConfirmAction
                action={chatDecision.bind(null, t.id)}
                choices={[
                  ...(t.assigneeId !== session?.userId ? [{ value: 'assign', label: c.assign, question: c.assign }] : []),
                  { value: 'resolve', label: c.resolve, question: c.confirmResolve },
                ]}
                doneText={{ assign: c.assigned, resolve: c.resolved }}
                errors={copy.errors}
                confirmText={copy.common.confirm}
                cancelText={copy.common.cancel}
              />
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}
