import { normalize, tokenize } from './text';

/**
 * Search synonyms (PRD FR-DIS-2): English ↔ Telugu transliteration ↔ Telugu script ↔ Hindi words
 * people type in Nellore ("biyyam" → rice, "pappu" → dal). Multi-way: any member finds the others.
 * Uploaded to Typesense as synonym sets and applied as query expansion by the in-memory index.
 * Extend from zero-result queries (search_performed with zero_result) after launch.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['atta', 'wheat flour', 'godhuma pindi', 'గోధుమ పిండి', 'గోధుమ'],
  ['dal', 'pappu', 'lentils', 'పప్పు', 'daal'],
  ['rice', 'biyyam', 'బియ్యం', 'annam', 'chawal'],
  ['milk', 'paalu', 'palu', 'పాలు', 'doodh'],
  ['curd', 'perugu', 'yogurt', 'పెరుగు', 'dahi'],
  ['ghee', 'neyyi', 'నెయ్యి'],
  ['oil', 'nune', 'నూనె', 'tel'],
  ['salt', 'uppu', 'ఉప్పు', 'namak'],
  ['sugar', 'chakkera', 'panchadara', 'చక్కెర', 'cheeni'],
  ['jaggery', 'bellam', 'బెల్లం', 'gur'],
  ['chilli', 'chili', 'mirchi', 'mirapakaya', 'మిర్చి', 'karam', 'కారం'],
  ['turmeric', 'pasupu', 'haldi', 'పసుపు'],
  ['tamarind', 'chintapandu', 'చింతపండు', 'imli'],
  ['onion', 'onions', 'ullipaya', 'ullipayalu', 'ఉల్లిపాయ', 'ఉల్లిపాయలు', 'pyaz'],
  ['tomato', 'tomatoes', 'tamata', 'టమాటా'],
  ['potato', 'potatoes', 'bangaladumpa', 'aloo', 'బంగాళదుంప', 'బంగాళదుంపలు'],
  ['brinjal', 'vankaya', 'eggplant', 'వంకాయ', 'baingan'],
  ['lady finger', 'bendakaya', 'okra', 'బెండకాయ', 'bhindi'],
  ['egg', 'eggs', 'guddu', 'gudlu', 'గుడ్డు', 'గుడ్లు', 'anda'],
  ['fish', 'chepa', 'chepala', 'చేప', 'చేపల', 'machli'],
  ['chicken', 'kodi', 'కోడి'],
  ['mutton', 'mamsam', 'మటన్', 'goat meat'],
  ['banana', 'bananas', 'arati', 'aratipandu', 'అరటి', 'అరటిపండ్లు', 'kela'],
  ['mango', 'mamidi', 'మామిడి', 'aam'],
  ['coconut', 'kobbari', 'కొబ్బరి', 'nariyal'],
  ['coffee', 'kaapi', 'కాఫీ'],
  ['tea', 'chai', 'టీ'],
  ['pickle', 'pachadi', 'uragaya', 'పచ్చడి', 'achar'],
  ['saree', 'sari', 'cheera', 'చీర', 'sarees'],
  ['chappals', 'chappal', 'slippers', 'sandals'],
  ['curry', 'kura', 'కూర'],
  ['meals', 'bhojanam', 'భోజనం', 'thali'],
  ['biscuits', 'biscuit', 'cookies'],
  ['soap', 'sabbu', 'సబ్బు'],
  ['medicine', 'medicines', 'mandulu', 'మందులు', 'tablets'],
  ['coriander', 'kothimeera', 'కొత్తిమీర', 'dhania'],
  ['curry leaves', 'karivepaku', 'కరివేపాకు'],
  ['ginger', 'allam', 'అల్లం', 'adrak'],
  ['garlic', 'vellulli', 'వెల్లుల్లి', 'lahsun'],
  ['groundnut', 'peanut', 'verusenaga', 'వేరుశెనగ', 'palli'],
  ['sesame', 'gingelly', 'nuvvulu', 'నువ్వులు', 'til'],
  ['rava', 'sooji', 'semolina', 'రవ్వ'],
  ['idli', 'idly', 'ఇడ్లీ'],
  ['dosa', 'dosai', 'దోశ'],
  ['biryani', 'biriyani', 'బిర్యానీ'],
];

const GROUPS = SYNONYM_GROUPS.map((g) => g.map((m) => tokenize(normalize(m))));

/** One query term: alternatives, each a token sequence that must all match ("lady finger"). */
export type QueryTerm = string[][];

/**
 * Parses a query into terms with synonym alternatives. Phrases are matched greedily, longest
 * first (up to 3 tokens), so "wheat flour 5 kg" → [[wheat,flour],[atta],…] · [5] · [kg].
 */
export function expandQuery(q: string): QueryTerm[] {
  const tokens = tokenize(q);
  const out: QueryTerm[] = [];
  for (let i = 0; i < tokens.length; ) {
    let matched = false;
    for (let len = Math.min(3, tokens.length - i); len >= 1 && !matched; len--) {
      const phrase = tokens.slice(i, i + len).join(' ');
      const group = GROUPS.find((g) => g.some((m) => m.join(' ') === phrase));
      if (group) {
        out.push(group.map((m) => [...m]));
        i += len;
        matched = true;
      }
    }
    if (!matched) out.push([[tokens[i]!]]);
    if (!matched) i++;
  }
  return out;
}

/**
 * Other words for what was typed, for the "Did you mean" line under the search box (FR-DIS-2):
 * Telugu script and transliterations first. Up to four, never the typed words themselves.
 */
export function searchHints(q: string, max = 4): string[] {
  const typed = new Set(tokenize(q));
  const typedPhrase = tokenize(q).join(' ');
  const out: string[] = [];
  for (const term of expandQuery(q)) {
    if (term.length < 2) continue;
    const alts = term.map((t) => t.join(' ')).filter((a) => a !== typedPhrase && !a.split(' ').every((w) => typed.has(w)));
    alts.sort((a, b) => Number(/[\u0C00-\u0C7F]/.test(b)) - Number(/[\u0C00-\u0C7F]/.test(a)));
    for (const a of alts) if (!out.includes(a) && out.length < max) out.push(a);
  }
  return out;
}
