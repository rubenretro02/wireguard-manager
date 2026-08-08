/**
 * Google-style fuzzy search for client-side lists.
 *
 * - Accent/case insensitive ("ramón" === "Ramon").
 * - Multi-term AND: every whitespace-separated term must match some field.
 * - Substring first ("amon" → "Ramon"), then a tight subsequence fallback so
 *   typos/skipped letters still hit ("rmon" → "Ramon") without matching everything.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

const norm = (s: string): string =>
  s.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();

/** Score of one term against one already-normalized field. -1 = no match. */
function termScore(field: string, term: string): number {
  const idx = field.indexOf(term);
  if (idx === 0) return 100;
  if (idx > 0) return /[\s.\-_@/:]/.test(field[idx - 1]) ? 80 : 60;

  // Subsequence fallback: only for terms long enough to be meaningful, and only
  // when the matched letters stay close together (otherwise "abc" matches everything).
  if (term.length < 3) return -1;
  let cursor = 0;
  let gaps = 0;
  for (const ch of term) {
    const next = field.indexOf(ch, cursor);
    if (next === -1) return -1;
    gaps += next - cursor;
    cursor = next + 1;
  }
  if (gaps > term.length * 2) return -1;
  return Math.max(1, 40 - gaps);
}

/**
 * Returns a relevance score for `query` across `fields`, or -1 when it doesn't match.
 * An empty query always matches (score 0).
 */
export function fuzzyScore(fields: Array<string | null | undefined>, query: string): number {
  const q = norm(query).trim();
  if (!q) return 0;

  const haystack = fields.filter(Boolean).map((f) => norm(String(f)));
  if (haystack.length === 0) return -1;

  let total = 0;
  for (const term of q.split(/\s+/)) {
    let best = -1;
    for (const field of haystack) {
      const score = termScore(field, term);
      if (score > best) best = score;
    }
    if (best < 0) return -1;
    total += best;
  }
  return total;
}

export const fuzzyMatch = (fields: Array<string | null | undefined>, query: string): boolean =>
  fuzzyScore(fields, query) >= 0;
