/**
 * Review moderation (M8) — classifier stub. Flags review text for a person to look at when it contains
 * contact details or links (off-platform deals, privacy), abuse (English and common Telugu-in-Latin
 * script words), or is shouting. Everything else is published at once. A real classifier can replace
 * this behind the same function.
 */
export interface ReviewScreen {
  flagged: boolean;
  reasons: Array<'contact_details' | 'link' | 'abuse' | 'shouting'>;
}

// The lookbehind starts a match only at the beginning of a run and every part is bounded, so this stays
// linear on hostile input (CodeQL js/polynomial-redos), e.g. thousands of '+' with no '@'.
const EMAIL = /(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}\.[\w.]{2,63}/;

const ABUSE = ['idiot', 'stupid', 'bastard', 'bloody', 'fraud', 'cheater', 'thief', 'donga', 'erripuka', 'lanja', 'gadida', 'kukka', 'pichi'];

export function screenReview(text: string | null | undefined): ReviewScreen {
  const t = (text ?? '').trim();
  if (!t) return { flagged: false, reasons: [] };
  const reasons: ReviewScreen['reasons'] = [];
  const digits = t.replace(/[\s\-().]/g, '');
  if (/(?:\+?91)?[6-9]\d{9}/.test(digits) || EMAIL.test(t)) reasons.push('contact_details');
  if (/(https?:\/\/|www\.|\b[\w-]+\.(com|in|net|org|xyz|link)\b)/i.test(t)) reasons.push('link');
  const words = t.toLowerCase().normalize('NFKD').split(/[^a-z]+/);
  if (words.some((w) => ABUSE.includes(w))) reasons.push('abuse');
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 12 && letters === letters.toUpperCase()) reasons.push('shouting');
  return { flagged: reasons.length > 0, reasons };
}
