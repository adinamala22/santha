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
  // delivery (M6)
  'rider.new_offer': {
    en: { title: 'New delivery · {pay}', body: 'Pickup at {store} ({distance} away). Accept within 30 seconds.' },
    te: { title: 'కొత్త డెలివరీ · {pay}', body: '{store} వద్ద పికప్ ({distance} దూరం). 30 సెకన్లలో అంగీకరించండి.' },
  },
  'staff.delivery_link': {
    en: { title: 'Delivery for {store}', body: 'Order {code}: open {link} for the address, pickup and delivery OTP steps.' },
    te: { title: '{store} డెలివరీ', body: 'ఆర్డర్ {code}: చిరునామా, పికప్ మరియు డెలివరీ OTP కోసం {link} తెరవండి.' },
  },
  'merchant.self_delivery_bonus': {
    en: { title: 'No rider yet for {code}', body: 'Deliver order {code} yourself and earn a {bonus} bonus. Open Santha Partner to switch.' },
    te: { title: '{code}కు ఇంకా రైడర్ లేరు', body: 'ఆర్డర్ {code} మీరే డెలివరీ చేసి {bonus} బోనస్ పొందండి. మార్చడానికి సంత పార్ట్‌నర్ తెరవండి.' },
  },
  'merchant.rider_assigned': {
    en: { title: 'Rider assigned for {code}', body: '{name} will pick up order {code}. Pickup code {pickup}.' },
    te: { title: '{code}కు రైడర్ వచ్చారు', body: '{name} ఆర్డర్ {code} పికప్ చేస్తారు. పికప్ కోడ్ {pickup}.' },
  },
  'customer.out_for_delivery': {
    en: { title: 'On the way', body: '{name} is bringing your order {code}. Share OTP {otp} at the door.' },
    te: { title: 'దారిలో ఉంది', body: '{name} మీ ఆర్డర్ {code} తెస్తున్నారు. తలుపు వద్ద OTP {otp} చెప్పండి.' },
  },
  'customer.order_delivered': {
    en: { title: 'Delivered', body: 'Your order {code} from {store} was delivered. Enjoy!' },
    te: { title: 'డెలివరీ అయింది', body: '{store} నుండి మీ ఆర్డర్ {code} డెలివరీ అయింది.' },
  },
  'customer.delivery_failed': {
    en: { title: 'We could not deliver {code}', body: 'Your order {code} from {store} could not be handed over. The delivery partner will call you, or Santha support will help shortly.' },
    te: { title: '{code} డెలివరీ కాలేదు', body: '{store} నుండి మీ ఆర్డర్ {code} అందించలేకపోయాం. డెలివరీ భాగస్వామి మీకు కాల్ చేస్తారు, లేదా సంత సపోర్ట్ త్వరలో సహాయం చేస్తుంది.' },
  },
  'merchant.delivery_failed': {
    en: { title: 'Order {code} not delivered', body: 'The customer could not be reached for order {code}. Santha support will tell you if it comes back to the store.' },
    te: { title: 'ఆర్డర్ {code} డెలివరీ కాలేదు', body: 'ఆర్డర్ {code} కస్టమర్‌ను చేరుకోలేకపోయాం. అది షాప్‌కు తిరిగి వస్తుందో లేదో సంత సపోర్ట్ చెబుతుంది.' },
  },
  'customer.delivery_delayed': {
    en: { title: 'Running a little late', body: 'Your order {code} will now arrive by {eta}. Sorry for the wait.' },
    te: { title: 'కొంచెం ఆలస్యం', body: 'మీ ఆర్డర్ {code} ఇప్పుడు {eta}కు వస్తుంది. ఆలస్యానికి క్షమించండి.' },
  },
  'customer.finding_courier': {
    en: { title: 'Finding a delivery partner', body: 'It is taking longer than usual to find someone for order {code}. New estimate {eta}. You can cancel for a full refund.' },
    te: { title: 'డెలివరీ భాగస్వామి కోసం వెతుకుతున్నాం', body: 'ఆర్డర్ {code}కు ఎవరినైనా కనుగొనడం ఆలస్యం అవుతోంది. కొత్త అంచనా {eta}. పూర్తి రీఫండ్‌తో రద్దు చేయవచ్చు.' },
  },
  // Rider onboarding (ADR-029)
  'rider.approved': {
    en: { title: 'You are approved to deliver', body: 'Welcome to Santha. Open the app, choose your areas and go online to get orders.' },
    te: { title: 'డెలివరీ చేయడానికి మీకు ఆమోదం లభించింది', body: 'సంతకు స్వాగతం. యాప్ తెరిచి, మీ ప్రాంతాలు ఎంచుకుని, ఆర్డర్ల కోసం ఆన్‌లైన్‌కి వెళ్లండి.' },
  },
  'rider.rejected': {
    en: { title: 'Your rider sign-up needs changes', body: '{reason} Open the app to fix your details and submit again.' },
    te: { title: 'మీ రైడర్ నమోదులో మార్పులు అవసరం', body: '{reason} యాప్ తెరిచి మీ వివరాలు సరిచేసి మళ్లీ సమర్పించండి.' },
  },
  'rider.suspended': {
    en: { title: 'Your rider account is paused', body: '{reason} Contact Santha support in the app.' },
    te: { title: 'మీ రైడర్ ఖాతా నిలిపివేయబడింది', body: '{reason} యాప్‌లో సంత సపోర్ట్‌ను సంప్రదించండి.' },
  },
  'support.reply': {
    en: { title: 'Santha support replied', body: 'Open the app to read the reply and continue the chat.' },
    te: { title: 'సంత సపోర్ట్ సమాధానం ఇచ్చింది', body: 'సమాధానం చదవడానికి, చాట్ కొనసాగించడానికి యాప్ తెరవండి.' },
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
