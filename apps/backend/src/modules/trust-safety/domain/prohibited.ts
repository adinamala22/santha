/**
 * Prohibited and restricted items (PRD FR-CAT-7, 9.x). Keyword screen at item creation and on edits;
 * a hit holds the item for ops review (status in_review) instead of rejecting it, because words
 * like "beer" appear in harmless names ("ginger beer"). The image classifier joins later behind the
 * same service.
 */
export interface ProhibitedRule {
  code: 'tobacco' | 'alcohol' | 'prescription_drug' | 'weapon' | 'wildlife' | 'adult' | 'fireworks';
  /** Matched on word boundaries, case-insensitive, after lower-casing and stripping accents. */
  terms: readonly string[];
}

export const PROHIBITED_RULES: readonly ProhibitedRule[] = [
  { code: 'tobacco', terms: ['cigarette', 'cigarettes', 'cigar', 'beedi', 'bidi', 'gutka', 'gutkha', 'khaini', 'tobacco', 'zarda', 'hookah', 'vape', 'e-cigarette', 'nicotine'] },
  { code: 'alcohol', terms: ['whisky', 'whiskey', 'vodka', 'rum', 'brandy', 'gin', 'beer', 'wine', 'toddy', 'kallu', 'arrack', 'liquor', 'alcohol'] },
  { code: 'prescription_drug', terms: ['codeine', 'tramadol', 'alprazolam', 'diazepam', 'morphine', 'schedule h', 'schedule x', 'antibiotic injection'] },
  { code: 'weapon', terms: ['gun', 'pistol', 'bullet', 'ammunition', 'knuckle duster', 'taser', 'air gun'] },
  { code: 'wildlife', terms: ['ivory', 'tiger skin', 'peacock feather fan', 'turtle meat', 'deer meat'] },
  { code: 'adult', terms: ['sex toy', 'adult toy'] },
  { code: 'fireworks', terms: ['crackers', 'fireworks', 'sutli bomb', 'rocket cracker'] },
];

/** Phrases that look prohibited but are not (checked before the rules). */
export const ALLOWED_PHRASES: readonly string[] = ['ginger beer', 'root beer', 'gin gin', 'wine vinegar', 'rum essence', 'cream cracker', 'cream crackers', 'gun powder tea', 'gunpowder tea'];

const norm = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RULES = PROHIBITED_RULES.map((r) => ({ code: r.code, re: new RegExp(`(^|[^a-z0-9])(${r.terms.map(escape).join('|')})([^a-z0-9]|$)`) }));

export interface ScreenResult {
  held: boolean;
  codes: ProhibitedRule['code'][];
  /** Human reason for the ops queue and the merchant. */
  reason: string | null;
}

export function screenText(...parts: Array<string | null | undefined>): ScreenResult {
  let text = norm(parts.filter(Boolean).join(' \n '));
  for (const p of ALLOWED_PHRASES) text = text.split(p).join(' ');
  const codes = RULES.filter((r) => r.re.test(text)).map((r) => r.code);
  return { held: codes.length > 0, codes, reason: codes.length ? `Needs review: may be a restricted item (${codes.join(', ')})` : null };
}
