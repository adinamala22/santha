/**
 * Notification copy, English + Telugu, one entry per template (keep in step with the DLT and
 * WhatsApp templates registered for production). `{name}` placeholders are filled from vars.
 */
export const TEMPLATES = {
  // merchant
  'merchant.new_order': {
    en: { title: 'New order {code}', body: '{items} items · {total}. Accept within {seconds} seconds.' },
    te: { title: 'కొత్త ఆర్డర్ {code}', body: '{items} వస్తువులు · {total}. {seconds} సెకన్లలో అంగీకరించండి.' },
  },
  'merchant.order_waiting': {
    en: { title: 'Order {code} is waiting', body: 'A customer is waiting. Open Santha Partner to accept order {code}.' },
    te: { title: 'ఆర్డర్ {code} వేచి ఉంది', body: 'ఒక కస్టమర్ వేచి ఉన్నారు. ఆర్డర్ {code} అంగీకరించడానికి సంత పార్ట్‌నర్ తెరవండి.' },
  },
  'merchant.auto_paused': {
    en: { title: 'Your store is paused', body: 'Two orders were missed in a row, so your store stopped taking orders. Open Santha Partner to resume.' },
    te: { title: 'మీ షాపు నిలిపివేయబడింది', body: 'వరుసగా రెండు ఆర్డర్లు మిస్ అయ్యాయి, అందుకే మీ షాపు ఆర్డర్లు తీసుకోవడం ఆపింది. మళ్ళీ ప్రారంభించడానికి సంత పార్ట్‌నర్ తెరవండి.' },
  },
  // customer
  'customer.order_placed': {
    en: { title: 'Order placed', body: '{store} has your order {code}. We will tell you when they accept it.' },
    te: { title: 'ఆర్డర్ అయింది', body: '{store}కు మీ ఆర్డర్ {code} చేరింది. వారు అంగీకరించగానే చెబుతాము.' },
  },
  'customer.order_accepted': {
    en: { title: 'Order accepted', body: '{store} is preparing your order {code}.' },
    te: { title: 'ఆర్డర్ అంగీకరించారు', body: '{store} మీ ఆర్డర్ {code} సిద్ధం చేస్తున్నారు.' },
  },
  'customer.order_ready': {
    en: { title: 'Packed and ready', body: 'Your order {code} from {store} is packed and will be on its way soon.' },
    te: { title: 'ప్యాక్ అయింది', body: '{store} నుండి మీ ఆర్డర్ {code} ప్యాక్ అయింది, త్వరలో బయలుదేరుతుంది.' },
  },
  'customer.order_rejected': {
    en: { title: 'Order not accepted', body: "{store} couldn't take order {code}. {refund}" },
    te: { title: 'ఆర్డర్ అంగీకరించలేదు', body: '{store} ఆర్డర్ {code} తీసుకోలేకపోయారు. {refund}' },
  },
  'customer.order_expired': {
    en: { title: 'Order not accepted', body: "{store} didn't respond to order {code}. {refund}" },
    te: { title: 'ఆర్డర్ అంగీకరించలేదు', body: '{store} ఆర్డర్ {code}కు స్పందించలేదు. {refund}' },
  },
  'customer.order_cancelled': {
    en: { title: 'Order cancelled', body: 'Order {code} from {store} was cancelled. {refund}' },
    te: { title: 'ఆర్డర్ రద్దు అయింది', body: '{store} నుండి ఆర్డర్ {code} రద్దు అయింది. {refund}' },
  },
  'customer.item_removed': {
    en: { title: 'An item was not available', body: '{name} was not available at {store}. {refund}' },
    te: { title: 'ఒక వస్తువు అందుబాటులో లేదు', body: '{store}లో {name} అందుబాటులో లేదు. {refund}' },
  },
  'customer.item_substituted': {
    en: { title: 'An item was replaced', body: '{store} replaced {name} with {substitute}. {refund}' },
    te: { title: 'ఒక వస్తువు మార్చారు', body: '{store} {name}కు బదులుగా {substitute} పంపుతున్నారు. {refund}' },
  },
  // shared refund sentence
  'fragment.refund_wallet': { en: { title: '', body: '{amount} is back in your Santha wallet.' }, te: { title: '', body: '{amount} మీ సంత వాలెట్‌కు తిరిగి వచ్చింది.' } },
  'fragment.refund_cod': { en: { title: '', body: 'You will pay {amount} less on delivery.' }, te: { title: '', body: 'డెలివరీ సమయంలో {amount} తక్కువ చెల్లిస్తారు.' } },
  'fragment.no_charge': { en: { title: '', body: 'You were not charged.' }, te: { title: '', body: 'మీ నుండి ఛార్జ్ చేయలేదు.' } },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;
export type Locale = 'en' | 'te';

export function render(key: TemplateKey, locale: Locale, vars: Record<string, string | number>): { title: string; body: string } {
  const t = TEMPLATES[key][locale] ?? TEMPLATES[key].en;
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : '')).replace(/\s+\./g, '.').trim();
  return { title: fill(t.title), body: fill(t.body) };
}

export const rupees = (paise: number) => `₹${(paise / 100).toFixed(paise % 100 === 0 ? 0 : 2)}`;
