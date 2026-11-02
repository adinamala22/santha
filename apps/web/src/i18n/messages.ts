/**
 * Web copy in English and Telugu. Every user-facing string lives here in both languages.
 * The landing page shows Telugu alongside English; the admin console (internal) defaults to English.
 */
export const messages = {
  en: {
    brand: { name: 'Santha', tagline: 'The whole town, one app.', taglineLine1: 'The whole town,', taglineLine2: 'one app.' },
    nav: { how: 'How it works', stores: 'For stores', kitchens: 'For home kitchens', riders: 'Riders', about: 'About', download: 'Download the app' },
    hero: {
      body: 'Groceries, medicines, sarees, home-cooked meals — from the Nellore shops and home kitchens you already trust, delivered to your door in 30–45 minutes.',
      android: 'Get it on Android',
      iphone: 'iPhone — join waitlist',
      facts: 'Local sellers · 4 micro-markets · UPI, cards or cash',
    },
    how: {
      title: 'How Santha works',
      steps: [
        { title: 'Browse every local shop', body: 'Kiranas, pharmacies, boutiques, home kitchens and home businesses near you — real stock, real prices.' },
        { title: 'Order in one app', body: 'One cart, transparent bill, UPI, cards or cash on delivery. Tell us what to do if an item is out.' },
        { title: 'Delivered in 30–45 min', body: "By the store's own staff or a Santha rider. Live tracking, OTP at the door, instant refunds." },
      ],
    },
    footer: { rights: 'Santha Technologies · Nellore, Andhra Pradesh', privacy: 'Privacy', terms: 'Terms', grievance: 'Grievance officer' },
    admin: {
      productName: 'Santha Ops',
      productBlurb: 'Operations console for the Santha marketplace.',
      productScope: 'Nellore · internal use only',
      signIn: 'Sign in',
      signInSub: 'Use your Santha work account',
      email: 'Work email',
      password: 'Password',
      continue: 'Continue',
      otpNote: 'You will be asked for a one-time code sent to your phone.',
      forgot: 'Forgot password',
      requestAccess: 'Request access',
      otpTitle: 'Enter the code',
      otpSub: 'We sent a 6-digit code to your registered phone.',
      otpLabel: 'One-time code',
      verify: 'Verify and sign in',
      back: 'Back',
      errors: {
        emailInvalid: 'Enter your work email (name@santha.in).',
        passwordRequired: 'Enter your password.',
        otpInvalid: 'Enter the 6-digit code.',
        unavailable: 'Ops sign-in is not available yet. Please try again later.',
        network: 'Could not reach Santha. Check your connection and try again.',
        credentials: 'Email or password is not right.',
        otpWrong: 'That code is not right. Check the SMS and try again.',
        rateLimited: 'Too many attempts. Please wait a few minutes and try again.',
      },
      sentTo: 'Code sent to {phone}.',
      submitting: 'Please wait…',
    },
  },
  te: {
    brand: { name: 'సంత', tagline: 'ఊరు అంతా, ఒక్క యాప్ లో.', taglineLine1: 'ఊరు అంతా,', taglineLine2: 'ఒక్క యాప్ లో.' },
    nav: { how: 'ఎలా పనిచేస్తుంది', stores: 'షాపుల కోసం', kitchens: 'ఇంటి వంటశాలల కోసం', riders: 'రైడర్లు', about: 'మా గురించి', download: 'యాప్ డౌన్‌లోడ్ చేయండి' },
    hero: {
      body: 'కిరాణా, మందులు, చీరలు, ఇంటి వంటలు — మీకు నమ్మకమైన నెల్లూరు షాపులు, ఇంటి వంటశాలల నుండి 30–45 నిమిషాల్లో మీ ఇంటికి.',
      android: 'Android లో పొందండి',
      iphone: 'iPhone — వెయిట్‌లిస్ట్‌లో చేరండి',
      facts: 'స్థానిక విక్రేతలు · 4 మైక్రో-మార్కెట్లు · UPI, కార్డులు లేదా నగదు',
    },
    how: {
      title: 'సంత ఎలా పనిచేస్తుంది',
      steps: [
        { title: 'ప్రతి స్థానిక షాపును చూడండి', body: 'మీ దగ్గరలోని కిరాణా, మెడికల్ షాపులు, బొటిక్‌లు, ఇంటి వంటశాలలు — నిజమైన స్టాక్, నిజమైన ధరలు.' },
        { title: 'ఒకే యాప్‌లో ఆర్డర్ చేయండి', body: 'ఒకే కార్ట్, స్పష్టమైన బిల్లు, UPI, కార్డులు లేదా క్యాష్ ఆన్ డెలివరీ. ఏదైనా వస్తువు లేకపోతే ఏం చేయాలో చెప్పండి.' },
        { title: '30–45 నిమిషాల్లో డెలివరీ', body: 'షాపు సిబ్బంది లేదా సంత రైడర్ ద్వారా. లైవ్ ట్రాకింగ్, డోర్ వద్ద OTP, వెంటనే రీఫండ్.' },
      ],
    },
    footer: { rights: 'సంత టెక్నాలజీస్ · నెల్లూరు, ఆంధ్రప్రదేశ్', privacy: 'గోప్యత', terms: 'నిబంధనలు', grievance: 'ఫిర్యాదుల అధికారి' },
    admin: {
      productName: 'సంత ఆప్స్',
      productBlurb: 'సంత మార్కెట్‌ప్లేస్ కోసం ఆపరేషన్స్ కన్సోల్.',
      productScope: 'నెల్లూరు · అంతర్గత ఉపయోగం మాత్రమే',
      signIn: 'సైన్ ఇన్',
      signInSub: 'మీ సంత వర్క్ ఖాతాను ఉపయోగించండి',
      email: 'వర్క్ ఇమెయిల్',
      password: 'పాస్‌వర్డ్',
      continue: 'కొనసాగించండి',
      otpNote: 'మీ ఫోన్‌కు పంపిన వన్-టైమ్ కోడ్ అడుగుతాము.',
      forgot: 'పాస్‌వర్డ్ మర్చిపోయారా',
      requestAccess: 'యాక్సెస్ కోరండి',
      otpTitle: 'కోడ్ నమోదు చేయండి',
      otpSub: 'మీ రిజిస్టర్డ్ ఫోన్‌కు 6 అంకెల కోడ్ పంపాము.',
      otpLabel: 'వన్-టైమ్ కోడ్',
      verify: 'ధృవీకరించి సైన్ ఇన్ చేయండి',
      back: 'వెనక్కి',
      errors: {
        emailInvalid: 'మీ వర్క్ ఇమెయిల్ నమోదు చేయండి (name@santha.in).',
        passwordRequired: 'మీ పాస్‌వర్డ్ నమోదు చేయండి.',
        otpInvalid: '6 అంకెల కోడ్ నమోదు చేయండి.',
        unavailable: 'ఆప్స్ సైన్-ఇన్ ఇంకా అందుబాటులో లేదు. దయచేసి తర్వాత ప్రయత్నించండి.',
        network: 'సంతను చేరుకోలేకపోయాము. మీ కనెక్షన్ చూసి మళ్లీ ప్రయత్నించండి.',
        credentials: 'ఇమెయిల్ లేదా పాస్‌వర్డ్ సరైనది కాదు.',
        otpWrong: 'ఆ కోడ్ సరైనది కాదు. SMS చూసి మళ్లీ ప్రయత్నించండి.',
        rateLimited: 'చాలా ప్రయత్నాలు చేశారు. కొన్ని నిమిషాలు ఆగి మళ్లీ ప్రయత్నించండి.',
      },
      sentTo: '{phone} కు కోడ్ పంపాము.',
      submitting: 'దయచేసి వేచి ఉండండి…',
    },
  },
} as const;

export type Locale = keyof typeof messages;

type Widen<T> = T extends string ? string : T extends readonly (infer U)[] ? readonly Widen<U>[] : { readonly [K in keyof T]: Widen<T[K]> };
export type Messages = Widen<(typeof messages)['en']>;

export function t(locale: Locale): Messages {
  return messages[locale];
}
