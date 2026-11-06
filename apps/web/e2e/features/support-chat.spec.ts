import { expect, test } from '@playwright/test';
import { appSignIn, call, freshPhone, HAS_OPS, opsSignIn } from '../support/target';

/**
 * Support chat (ADR-028), fake + live: a new customer writes from the app (API), support answers from the console
 * with a ready reply, the customer sees it as unread and answers, support resolves it. The chat is resolved at the
 * end, so nothing is left waiting in the live inbox.
 */
test.setTimeout(120_000);

test('a customer writes; support replies from the console with a ready reply; resolved', async ({ page, request }) => {
  test.skip(!HAS_OPS, 'needs E2E_OPS_EMAIL / E2E_OPS_PASSWORD on live');
  const customer = await appSignIn(request, freshPhone(), 'consumer');
  const marker = `E2E ${Date.now()}`;
  const t = await call(request, 'post', '/support/threads', { headers: customer, data: { topic: 'payment', body: `${marker}: charged twice?` }, status: 201 });
  expect(t.status).toBe('waiting_support');

  await opsSignIn(page, '/admin/support?status=waiting_support');
  await expect(page.getByTestId(`support-${t.id}`)).toContainText(`${marker}: charged twice?`);
  await page.getByTestId(`support-${t.id}`).getByRole('link').click();
  await expect(page.getByTestId('support-messages')).toContainText('charged twice?');

  const reply = page.getByTestId('support-reply');
  await reply.getByLabel('Insert a ready reply').selectOption({ index: 1 }); // "Hello! Thanks for writing…"
  await expect(reply.getByLabel('Reply', { exact: true })).toHaveValue(/Thanks for writing to Santha/);
  await reply.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByTestId('support-messages')).toContainText('Thanks for writing to Santha');

  const mine = await call(request, 'get', '/support/threads', { headers: customer });
  expect(mine.items[0]).toMatchObject({ id: t.id, status: 'waiting_customer', unreadByUser: 1 });
  await call(request, 'post', `/support/threads/${t.id}/messages`, { headers: customer, data: { body: 'Thank you' }, status: 201 });

  await page.reload();
  await expect(page.getByTestId('support-messages')).toContainText('Thank you');
  await page.getByRole('button', { name: 'Resolve' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(async () => (await call(request, 'get', `/support/threads/${t.id}`, { headers: customer })).status).toBe('resolved');
});
