/**
 * Text handling shared by the in-memory index and query parsing. Works for English and Telugu
 * script: NFKC, lower-case, split on anything that is not a letter, combining mark or digit.
 */
export function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

export function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return normalize(s)
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/** Levenshtein distance, giving up (returns max + 1) once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Typo budget by token length (like Typesense's defaults): none under 4 chars, 1 up to 7, then 2. */
export const typoBudget = (len: number) => (len < 4 ? 0 : len < 8 ? 1 : 2);
