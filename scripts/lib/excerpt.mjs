/**
 * Which slice of a page the reader is shown.
 *
 * sourceExcerpt() centres the window on the claimed value, which is right for
 * a number: "38.5" is findable, so the window lands on the sentence stating
 * it. For every field the model layer actually handles, the value is NOT on
 * the page -- `textile-only` is our vocabulary, `open` is our enum, a price
 * summary is a human rendering -- so the search always misses and the
 * fallback returns the first 6,000 characters.
 *
 * That fallback caused a false refutation on a real claim. The Banff safety
 * page states its swimwear rule at character 8,148; the excerpt ended at
 * 6,000, and the verifier correctly reported that the text it was given did
 * not mention a clothing policy. The claim was true. The reader was shown the
 * wrong part of the page.
 *
 * Worse than a one-off: the bias is systematic and one-directional. Long
 * pages bury their specifics below the navigation, and the prompt defaults to
 * refuted when uncertain, so head-truncation turns "I was not shown it" into
 * "it is not there" every time. On a long page the semantic layer was
 * measuring page layout, not truth.
 *
 * So for a value the page does not contain, the window is chosen by what the
 * FIELD is about instead. Keywords rather than an embedding: they are
 * inspectable, free, deterministic, and a reviewer can tell why a window was
 * chosen. When nothing matches, the head is still the fallback -- but that is
 * now the rare case rather than every case.
 */

/**
 * Words that mark the part of a page a field is decided by.
 *
 * Deliberately over-inclusive. A window that is slightly off costs tokens; a
 * window that misses the paragraph costs a true claim.
 */
export const FIELD_KEYWORDS = {
  'clothing.policy': ['swimwear', 'swimsuit', 'bathing suit', 'attire', 'dress code', 'clothing', 'nude', 'topless'],
  'clothing.schedule': ['swimwear', 'swimsuit', 'clothing-optional', 'dress code', 'schedule'],
  'clothing.notes': ['swimwear', 'swimsuit', 'attire', 'dress code', 'clothing'],
  'temperature.kind': ['emerges', 'source', 'spring water', 'heated', 'pool temperature', 'kept at', 'degrees'],
  'access.price': ['price', 'fee', 'admission', 'rate', 'ticket', 'cost', 'adult', 'child'],
  'access.currency': ['price', 'fee', 'admission', 'rate', 'ticket', 'cost'],
  'access.notes': ['access', 'entry', 'admission', 'parking', 'reservation'],
  'hours.open': ['hours', 'open', 'opening', 'closed', 'daily', 'schedule'],
  'hours.status': ['hours', 'open', 'opening', 'closed', 'season'],
  'hours.seasonalNotes': ['season', 'hours', 'closed', 'winter', 'summer', 'holiday'],
  'minerals.notes': ['mineral', 'composition', 'analysis', 'water quality', 'mg/l', 'dissolved'],
  'minerals.types': ['mineral', 'composition', 'sulphur', 'sulfur', 'chloride', 'bicarbonate', 'spring quality'],
  'minerals.measuredAt': ['analysis', 'analysed', 'analyzed', 'tested', 'sampled'],
  description: ['about', 'history', 'overview'],
  'location.region': ['region', 'province', 'state', 'county'],
  'location.nearestTown': ['town', 'village', 'city', 'near'],
  name: ['name', 'known as'],
};

/**
 * The window where the field's keywords are densest.
 *
 * Earliest hit was the first attempt and it failed on the page that motivated
 * this file: "Swimwear" appears at character 1,206 in a navigation list and
 * again at 8,148 in the actual rule. Centring on the first hit clamped the
 * window to the head and missed the rule by two thousand characters -- the
 * same false refutation, reached a different way.
 *
 * Density fixes it without tuning. A navigation entry is one word on its own;
 * the section that decides the field says swimwear, bathing suit and clothing
 * within a paragraph of each other. Counting every occurrence of every
 * keyword inside each candidate window and taking the best is enough to tell
 * those apart, and ties break toward the earlier window so behaviour stays
 * deterministic.
 *
 * @returns {{text: string, at: number, matched: string | null, score: number}}
 */
export function fieldExcerpt(text, field, max) {
  const hay = text.toLowerCase();
  const keywords = (FIELD_KEYWORDS[field] ?? []).map((k) => k.toLowerCase());

  if (text.length <= max) {
    return { text, at: 0, matched: keywords.find((k) => hay.includes(k)) ?? null, score: 0 };
  }

  // Every occurrence of every keyword, not just the first of each.
  const hits = [];
  for (const kw of keywords) {
    for (let at = hay.indexOf(kw); at !== -1; at = hay.indexOf(kw, at + 1)) {
      hits.push({ at, kw });
    }
  }
  if (hits.length === 0) return { text: text.slice(0, max), at: 0, matched: null, score: 0 };

  // One candidate window per hit, clamped so a hit near either end still
  // yields a full-width window.
  let best = { start: 0, score: -1, matched: null };
  for (const hit of hits) {
    const start = Math.max(0, Math.min(hit.at - Math.floor(max / 2), text.length - max));
    const end = start + max;
    const score = hits.filter((h) => h.at >= start && h.at < end).length;
    // Strictly greater, so ties keep the earliest window.
    if (score > best.score) best = { start, score, matched: hit.kw };
  }
  return {
    text: text.slice(best.start, best.start + max),
    at: best.start,
    matched: best.matched,
    score: best.score,
  };
}
