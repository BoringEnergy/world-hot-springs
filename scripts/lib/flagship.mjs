/**
 * Which springs the first enrichment pass targets.
 *
 * Two per country, over-provisioned to five candidates each. The cap is a
 * volume dial and nothing else: every cap reaches all 129 countries, because a
 * cap only trims the top of the distribution and every country still
 * contributes at least one spring. See the phase 3 spec for the measurement
 * that established this and corrected the first draft's reasoning.
 */

/** How many claims a country needs before the run moves on. */
export const TARGET_PER_COUNTRY = 2;

/**
 * How deep the fallback list goes. Over-provisioned because sources fail: a
 * flat "take exactly two" cannot tell "this country has no findable sources"
 * apart from "we did not try".
 */
export const CANDIDATES_PER_COUNTRY = 5;

/**
 * Ordering, most significant first:
 *
 *   1. named before unnamed — an unnamed spring has nothing to search for and
 *      is close to unenrichable, whatever else is known about it
 *   2. higher completeness first — more context for the proposer to anchor on
 *   3. id ascending — so a tie never depends on the order the dataset happens
 *      to arrive in, which is what makes the output diffable
 */
function rank(a, b) {
  const named = Number(Boolean(b.name)) - Number(Boolean(a.name));
  if (named !== 0) return named;
  const complete = (b.quality?.completeness ?? 0) - (a.quality?.completeness ?? 0);
  if (complete !== 0) return complete;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * @param {object[]} springs the published dataset
 * @returns {{country: string, candidates: string[]}[]} sorted by country code
 */
export function selectFlagship(springs) {
  const byCountry = new Map();
  for (const s of springs) {
    // Country is at location.country. There is no top-level s.country on any
    // record; reading one yields undefined for all 6,471 and selects nothing.
    const country = s.location?.country;
    if (!country) continue;
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country).push(s);
  }

  return [...byCountry.keys()]
    .sort()
    .map((country) => ({
      country,
      candidates: byCountry
        .get(country)
        .slice()
        .sort(rank)
        .slice(0, CANDIDATES_PER_COUNTRY)
        .map((s) => s.id),
    }));
}
