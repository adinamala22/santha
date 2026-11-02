// k6 load test at 5x pilot peak (Tech plan 6.2: ~120 orders/hour at peak, so 600 orders/hour).
// Three scenarios run together: feed browsing and search (read-heavy) and checkout (COD orders).
//
//   k6 run infra/k6/peak.js                                    # against the local fake service
//   k6 run -e BASE=https://api.staging.santha.in/v1 infra/k6/peak.js
//
// Use staging or the fake service only, never production. OTP 123456 works only where
// OTP_DEV_CODE is set. Orders are cash on delivery, so no payment provider is called.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:4000/v1';
const KIRANA = __ENV.MERCHANT_ID || '10000000-0000-4000-8000-000000000201';
const DURATION = __ENV.DURATION || '10m';
const placeLatency = new Trend('order_place_ms', true);

export const options = {
  scenarios: {
    // About 10 feed views per order at 600 orders/hour.
    feed: { executor: 'constant-arrival-rate', exec: 'feed', rate: 100, timeUnit: '1m', duration: DURATION, preAllocatedVUs: 10, maxVUs: 40 },
    search: { executor: 'constant-arrival-rate', exec: 'search', rate: 60, timeUnit: '1m', duration: DURATION, preAllocatedVUs: 5, maxVUs: 20 },
    checkout: { executor: 'constant-arrival-rate', exec: 'checkout', rate: 10, timeUnit: '1m', duration: DURATION, preAllocatedVUs: 5, maxVUs: 20 },
  },
  // Budgets: PRD 8 and docs/performance-budgets.md.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:feed}': ['p(95)<1200'],
    'http_req_duration{name:search}': ['p(95)<400'],
    order_place_ms: ['p(95)<3000'],
  },
};

const json = (body) => JSON.stringify(body);
const plain = { headers: { 'content-type': 'application/json' } };
const auth = (s) => ({ 'content-type': 'application/json', Authorization: `Bearer ${s.token}`, 'X-Device-Id': s.deviceId });

export function setup() {
  // Sign in the two seeded test consumers once (OTP is rate limited per phone).
  const sessions = ['9000000001', '9000000002'].map((phone) => {
    const deviceId = `k6-${phone}`;
    const c = http.post(`${BASE}/auth/otp/request`, json({ phone, app: 'consumer', deviceId }), plain).json();
    const s = http
      .post(`${BASE}/auth/otp/verify`, json({ challengeId: c.challengeId, code: __ENV.OTP || '123456', deviceId, app: 'consumer', platform: 'android' }), plain)
      .json();
    const session = { token: s.accessToken, deviceId };
    const addresses = http.get(`${BASE}/me/addresses`, { headers: auth(session) }).json();
    return { ...session, addressId: addresses.items[0].id, location: addresses.items[0].location };
  });
  const loc = sessions[0].location;
  const store = http.get(`${BASE}/stores/${KIRANA}?lat=${loc.lat}&lng=${loc.lng}`).json();
  const item = store.items[0];
  return { sessions, loc, item: { id: item.id, variantId: item.variants[0].id } };
}

export function feed(d) {
  const r = http.get(`${BASE}/feed?lat=${d.loc.lat}&lng=${d.loc.lng}&tab=stores`, { tags: { name: 'feed' } });
  check(r, { 'feed 200': (x) => x.status === 200 });
}

const QUERIES = ['atta', 'rice', 'dal', 'milk', 'biryani', 'oil', 'soap', 'meals'];
export function search(d) {
  const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const r = http.get(`${BASE}/search?q=${q}&lat=${d.loc.lat}&lng=${d.loc.lng}`, { tags: { name: 'search' } });
  check(r, { 'search 200': (x) => x.status === 200 });
}

export function checkout(d) {
  const s = d.sessions[Math.floor(Math.random() * d.sessions.length)];
  const h = auth(s);
  http.put(`${BASE}/cart`, json({ merchantId: KIRANA, replace: true, lines: [{ itemId: d.item.id, variantId: d.item.variantId, quantity: 1 }] }), {
    headers: h,
    tags: { name: 'cart' },
  });
  const q = http.post(`${BASE}/cart/price`, json({ addressId: s.addressId, when: { mode: 'asap' } }), { headers: h, tags: { name: 'price' } });
  if (!check(q, { priced: (x) => x.status === 200 || x.status === 201 })) return;
  const t0 = Date.now();
  const o = http.post(`${BASE}/orders`, json({ quoteId: q.json().quoteId, paymentMethod: 'cod' }), {
    headers: { ...h, 'Idempotency-Key': `k6-${__VU}-${__ITER}-${t0}` },
    tags: { name: 'place' },
  });
  placeLatency.add(Date.now() - t0);
  check(o, { placed: (x) => x.status === 201 });
  sleep(1);
}
