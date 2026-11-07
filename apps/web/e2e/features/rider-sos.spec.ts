import { expect, test } from '@playwright/test';
import { appSignIn, call, HAS_OPS, opsSignIn } from '../support/target';

/**
 * Rider SOS (ADR-031), fake + live: a demo rider presses SOS (API, as the app does), it is first on the live board
 * with the location, ops open the rider page, see the phone to call, and resolve it with a note (audited). The alert
 * is resolved at the end, so nothing is left open on the test environment. Also: the 7-day earnings summary.
 */
test.setTimeout(120_000);

test('SOS reaches the live board; ops call the rider and resolve it', async ({ page, request }) => {
  test.skip(!HAS_OPS, 'needs E2E_OPS_EMAIL / E2E_OPS_PASSWORD on live');
  const rider = await appSignIn(request, '9000000103', 'rider'); // Demo Rider 3
  const sos = await call(request, 'post', '/riders/me/sos', { headers: rider, data: { lat: 14.4426, lng: 79.9865 }, status: 200 });

  await opsSignIn(page, '/admin/live');
  const item = page.getByTestId(`sos-${sos.id}`);
  await expect(item).toContainText('SOS from Demo Rider 3');
  await expect(item.getByRole('link', { name: /Google Maps/ })).toHaveAttribute('href', /query=14\.4426,79\.9865/);
  await page.getByTestId(`sos-open-${sos.id}`).click();

  const panel = page.getByTestId('rider-sos');
  await expect(panel).toContainText('SOS ·');
  await expect(panel.getByRole('link', { name: /Call the rider/ })).toHaveAttribute('href', /^tel:\+91/);
  await panel.getByRole('button', { name: 'Resolve' }).click();
  await page.getByLabel('What happened').fill('E2E: called the rider, all fine.');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('rider-sos')).toHaveCount(0); // resolved: the page refreshes without it

  await page.goto('/admin/live');
  await expect(page.getByTestId(`sos-${sos.id}`)).toHaveCount(0);
});

test('the rider sees the last 7 days of earnings', async ({ request }) => {
  const rider = await appSignIn(request, '9000000103', 'rider');
  const week = await call(request, 'get', '/riders/me/earnings/week', { headers: rider });
  expect(week.days).toHaveLength(7);
  const dates = week.days.map((d: { date: string }) => d.date);
  expect(dates).toEqual([...dates].sort());
  expect(week.totalPaise).toBe(week.days.reduce((s: number, d: { earnedPaise: number }) => s + d.earnedPaise, 0));
});
