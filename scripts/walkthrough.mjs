#!/usr/bin/env node
// End-to-end walkthrough of the whole marketplace against a running fake service (`pnpm dev:fake`).
// It narrates each step and stops with a non-zero exit code when one fails, so CI runs it as a smoke test.
//
//   pnpm dev:fake          # terminal 1 (backend :4000; the web console on :3000 is optional)
//   pnpm walkthrough       # terminal 2; BASE=http://host:4000/v1 to point elsewhere
//
// Only use it against the fake service or a dev stack with mock providers: it uses the dev payment
// endpoints and OTP 123456. It never calls a live payment, SMS or KYC provider.
const B = process.env.BASE ?? 'http://localhost:4000/v1';
const KIRANA = '10000000-0000-4000-8000-000000000201'; // Ramesh Stores, Dargamitta
const rupees = (p) => `₹${(p / 100).toFixed(2)}`;
let step = 0;
const say = (msg) => console.log(`\n${String(++step).padStart(2, ' ')}. ${msg}`);
const note = (msg) => console.log(`    ${msg}`);
const ok = (cond, msg) => {
  if (!cond) throw new Error(`check failed: ${msg}`);
  note(`✓ ${msg}`);
};

async function call(method, path, body, headers = {}) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
async function signIn(phone, app) {
  const deviceId = `walkthrough-${app}-${phone}`;
  let c;
  for (let attempt = 0; !c; attempt++) {
    const r = await fetch(`${B}/auth/otp/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, app, deviceId }) });
    const body = await r.json();
    if (r.ok) c = body;
    else if (r.status === 429 && attempt < 3) {
      // OTP resend cooldown from an earlier run: wait it out.
      const wait = body.error?.details?.retryAfterSec ?? 30;
      if (wait > 60) throw new Error(`OTP hourly limit reached for ${phone} after several runs. Restart the fake service (pnpm dev:fake resets in-memory limits) and run again.`);
      note(`(OTP cooldown for ${phone}: waiting ${wait}s)`);
      await new Promise((res) => setTimeout(res, wait * 1000 + 200));
    } else throw new Error(`POST /auth/otp/request → ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  const s = await call('POST', '/auth/otp/verify', { challengeId: c.challengeId, code: '123456', deviceId, app, platform: 'android' });
  return { Authorization: `Bearer ${s.accessToken}`, 'X-Device-Id': deviceId };
}
async function opsSignIn(email, password) {
  const deviceId = `walkthrough-ops-${email.replace(/[^A-Za-z0-9]/g, '-')}`;
  const l = await call('POST', '/auth/ops/login', { email, password, deviceId });
  const s = await call('POST', '/auth/ops/verify', { challengeId: l.challengeId, code: '123456', deviceId });
  return { Authorization: `Bearer ${s.accessToken}`, 'X-Device-Id': deviceId };
}
const north = (p, m) => ({ lat: p.lat + m / 111_195, lng: p.lng });
const istDate = (d = new Date()) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

async function main() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${B}/health`)).ok) break;
    } catch {}
    if (i === 0) console.log(`waiting for ${B} …`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  say('The people: a store owner, a rider, a customer and the ops team sign in (OTP 123456 in dev)');
  const owner = await signIn('9000000201', 'merchant');
  const rider = await signIn('9000000101', 'rider');
  const customer = await signIn('9000000001', 'consumer');
  const ops = await opsSignIn('admin@santha.local', 'santha-admin-dev');
  const day = [{ open: '00:00', close: '23:59' }];
  const me = await call('PATCH', '/merchants/me', { hours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day } }, owner);
  const store = me.merchant.location;
  note(`${me.merchant.name} is open all day for the walkthrough (micro-market ${me.microMarket.name})`);

  say('Customer: consent, delivery address, serviceability and the home feed');
  await call('PUT', '/me/consents', { purpose: 'terms', granted: true }, customer);
  await call('PUT', '/me/consents', { purpose: 'privacy', granted: true }, customer);
  const address = (await call('GET', '/me/addresses', null, customer)).items[0];
  const svc = await call('GET', `/serviceability?lat=${address.location.lat}&lng=${address.location.lng}`);
  ok(svc.serviceable, `"${address.line}" is inside ${svc.microMarket.name}`);
  const feed = await call('GET', `/feed?lat=${address.location.lat}&lng=${address.location.lng}&tab=stores`);
  ok(feed.stores.some((s) => s.id === KIRANA), `the feed shows ${feed.stores.length} store(s), including ${me.merchant.name}`);

  say('Customer: search "atta", fill the cart, get the bill and pay online (mock gateway)');
  const results = await call('GET', `/search?q=atta&lat=${address.location.lat}&lng=${address.location.lng}`);
  note(`search found ${results.totalItems} item(s) in ${results.groups.length} store(s) in ${results.tookMs} ms (Telugu hint: ${results.hints[0] ?? '—'})`);
  const page = await call('GET', `/stores/${KIRANA}?lat=${store.lat}&lng=${store.lng}`);
  const atta = page.items.find((i) => i.name === 'Annapoorna Chakki Atta');
  const rice = page.items.find((i) => i.name === 'Annapoorna Basmati Rice');
  async function order(paymentMethod) {
    await call('PUT', '/cart', { merchantId: KIRANA, replace: true, lines: [{ itemId: atta.id, variantId: atta.variants[0].id, quantity: 2 }, { itemId: rice.id, variantId: rice.variants[0].id, quantity: 1 }] }, customer);
    const quote = await call('POST', '/cart/price', { addressId: address.id, when: { mode: 'asap' } }, customer);
    const o = await call('POST', '/orders', { quoteId: quote.quoteId, paymentMethod }, { ...customer, 'Idempotency-Key': `walkthrough-${Date.now()}-${Math.random()}` });
    return { o, quote };
  }
  const { o: o1, quote } = await order('online');
  note(`bill: items ${rupees(quote.bill.itemsPaise)} · total ${rupees(quote.bill.totalPaise)} (integer paise, recomputed from lines)`);
  await call('POST', `/dev/payments/${o1.payment.intentId}/succeed`);
  ok((await call('GET', `/orders/${o1.id}`, null, customer)).state === 'PLACED', `order ${o1.code} is placed once the payment is captured`);

  say('Store: the order rings; the owner accepts it for a Santha rider and packs it');
  await call('PUT', '/riders/me/status', { online: true, zones: [me.microMarket.id] }, rider);
  await call('POST', '/riders/me/location', north(store, 300), rider);
  await call('POST', `/orders/${o1.id}/accept`, { fulfilmentMode: 'rider' }, owner);
  await call('POST', `/orders/${o1.id}/ready`, null, owner);
  ok(true, 'accepted → ready (each change goes through the guarded transition and the outbox)');

  say('Rider: offer with the pay shown up front → pickup code at the store → OTP at the door');
  const offer = (await call('GET', '/riders/me', null, rider)).offer;
  ok(!!offer, `offer for ${rupees(offer.payPaise ?? offer.pay?.totalPaise ?? 0)}`);
  const job = await call('POST', `/offers/${offer.id}/accept`, null, rider);
  const pickup = (await call('GET', '/merchants/me/deliveries', null, owner)).items.find((x) => x.orderId === o1.id).pickupCode;
  await call('POST', `/jobs/${job.id}/picked-up`, { pickupCode: pickup }, rider);
  const otp = (await call('GET', `/orders/${o1.id}/tracking`, null, customer)).deliveryOtp;
  await call('POST', `/jobs/${job.id}/delivered`, { otp }, rider);
  ok((await call('GET', `/orders/${o1.id}`, null, customer)).state === 'DELIVERED', `${o1.code} delivered`);

  say('Second order: cash on delivery, delivered by the store\'s own staff through a staff link');
  const { o: o2 } = await order('cod');
  await call('POST', `/orders/${o2.id}/accept`, { fulfilmentMode: 'self', staffId: me.staff[0].id }, owner);
  await call('POST', `/orders/${o2.id}/ready`, null, owner);
  const d2 = (await call('GET', '/merchants/me/deliveries', null, owner)).items.find((x) => x.orderId === o2.id);
  const token = d2.staffLink.split('/d/')[1];
  await call('POST', `/staff-jobs/${token}/picked-up`);
  await call('POST', `/staff-jobs/${token}/delivered`, { otp: (await call('GET', `/orders/${o2.id}/tracking`, null, customer)).deliveryOtp, codCollectedPaise: o2.totalPaise });
  ok((await call('GET', `/orders/${o2.id}`, null, customer)).state === 'DELIVERED', `${o2.code} delivered by store staff (cash collected)`);

  say('Customer: rates the first order and reports the rice missing → refund to the wallet at once');
  await call('POST', `/orders/${o1.id}/rating`, { storeStars: 5, riderStars: 5, comment: 'Fresh atta and a quick rider, thank you' }, customer);
  const detail = await call('GET', `/orders/${o1.id}`, null, customer);
  const riceLine = detail.lines.find((l) => l.name === 'Annapoorna Basmati Rice');
  const issue = await call('POST', `/orders/${o1.id}/issues`, { type: 'missing_item', variantIds: [riceLine.variantId], description: 'The rice was not in the bag' }, customer);
  ok(issue.status === 'auto_resolved', `issue ${issue.status}: ${rupees(issue.refundPaise)} to the ${issue.refundDestination}`);
  const wallet = await call('GET', '/wallet', null, customer);
  note(`wallet balance ${rupees(wallet.balancePaise)}`);

  say('Store: replies to the review; sees the refund charged to it and disputes it');
  const reviews = await call('GET', '/merchants/me/reviews', null, owner);
  await call('POST', `/merchants/me/reviews/${o1.id}/reply`, { text: 'Thank you! Sorry about the rice.' }, owner);
  ok(reviews.items.some((r) => r.orderId === o1.id), 'the review is published and the reply posted');

  say('Money: tonight\'s store settlement → payout with commission, GST, TCS and TDS → statement');
  await call('POST', '/ops/settlements/run', { kind: 'merchant', date: istDate() }, ops);
  const payout = (await call('GET', '/merchants/me/payouts', null, owner)).items[0];
  const t = payout.totals;
  note(`net ${rupees(payout.netPaise)} = items ${rupees(t.itemsPaise)} − commission ${rupees(t.commissionPaise)} − GST ${rupees(t.cgstPaise + t.sgstPaise)} − TCS ${rupees(t.tcsPaise)} − TDS ${rupees(t.tdsPaise)} ± adjustments`);
  ok(payout.hasStatement, `payout ${payout.status}; PDF statement and CSV available`);
  const refunds = await call('GET', '/merchants/me/refunds', null, owner);
  const dispute = await call('POST', '/merchants/me/disputes', { refundId: refunds.items.find((r) => r.orderCode === o1.code).id, reason: 'The rice was packed; the counter camera shows it.' }, owner);
  const resolved = await call('POST', `/ops/disputes/${dispute.id}/resolve`, { decision: 'accept', note: 'CCTV confirms packing' }, ops);
  ok(resolved.status === 'accepted', `dispute accepted: ${rupees(resolved.adjustmentPaise)} back to the store on the next payout`);

  say('Rider weekly payout: delivery pay minus cash held');
  const nextWeek = istDate(new Date(Date.now() + 7 * 86_400_000));
  await call('POST', '/ops/settlements/run', { kind: 'rider_weekly', date: nextWeek }, ops);
  const rp = (await call('GET', '/riders/me/payouts', null, rider)).items[0];
  ok(!!rp, `rider payout ${rupees(rp.netPaise)} (${rp.lines.length} delivery line(s))`);
  await call('PUT', '/riders/me/status', { online: false }, rider);

  say('Trust & privacy: a grievance with legal clocks, and a data export (DPDP)');
  const g = await call('POST', '/me/grievances', { category: 'refund', description: 'Please confirm when the refund reaches my bank.', orderId: o1.id }, customer);
  await call('POST', `/ops/grievances/${g.id}/acknowledge`, null, ops);
  const gr = await call('POST', `/ops/grievances/${g.id}/resolve`, { resolution: 'The refund is in your Santha wallet already; it can be used on the next order.' }, ops);
  ok(gr.status === 'resolved', `grievance acknowledged and resolved (due by ${gr.resolveDueAt.slice(0, 10)})`);
  const dr = await call('POST', '/me/data-requests', { type: 'access' }, customer);
  const exp = await (await fetch(`${B}/me/data-requests/${dr.id}/export`, { headers: customer })).json();
  ok(exp.orders.length >= 2, `export ready at once: ${exp.orders.length} orders, ${exp.addresses.length} addresses, ${exp.consents.length} consents`);

  say('Ops reports: funnel, on-time, fill rate and contribution per order');
  const rep = await call('GET', '/ops/reports', null, ops);
  note(`funnel placed ${rep.funnel.placed} → delivered ${rep.funnel.delivered} · on-time ${rep.onTimePercent}% · fill ${rep.fillRatePercent}%`);
  ok(rep.funnel.delivered >= 2, `contribution ${rupees(rep.contribution.totalPaise)} (${rep.contribution.perOrderPaise == null ? '—' : rupees(rep.contribution.perOrderPaise)} per order)`);

  say('Public store link page data (/s/<slug> on the website)');
  const pub = (await call('GET', '/public/stores')).items.find((s) => s.name === me.merchant.name);
  const sp = await call('GET', `/public/stores/${pub.slug}`);
  ok(sp.name === me.merchant.name, `/s/${pub.slug}: ${sp.name}, ${sp.area} · ★ ${sp.rating.avg ?? '—'} from ${sp.rating.count} review(s)`);

  console.log(`\nWalkthrough complete: ${step} steps. Open http://localhost:3000/admin to see the same orders, payouts, disputes, grievances and reports in the console.`);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
