/**
 * Where public knowledge about hot springs does not exist.
 *
 * Published deliberately. This does not measure a country -- it measures the
 * reach of public, indexable sources this run could verify. Saying so out loud
 * is more honest than quietly shipping a thin record and letting a reader
 * assume the springs are thin. It is also the only part of this system that
 * improves by being wrong in public: someone who knows the Bolivian sources
 * exist is far likelier to appear if the atlas says plainly it could not find
 * them.
 */
import { TARGET_PER_COUNTRY } from './flagship.mjs';

/** Travels inside the artifact, because a README is not read beside a JSON file. */
export const MEASURES =
  'reach of public, indexable sources this run could verify — not the number of hot springs a country has, and not their quality';

export function buildCoverage(results, timestamp) {
  return {
    generatedAt: timestamp,
    measures: MEASURES,
    target: TARGET_PER_COUNTRY,
    countries: results
      .slice()
      .sort((a, b) => (a.country < b.country ? -1 : a.country > b.country ? 1 : 0))
      .map((r) => ({
        country: r.country,
        candidates: r.candidates,
        attempted: r.attempted,
        verified: r.verified,
        // Capped by what the country can actually offer. 21 countries have
        // exactly one spring in the dataset; a perfect run there verifies one
        // of one, and reporting `unmet: 1` forever would make the artifact
        // say the opposite of what happened -- in the one file the spec
        // insists must not mislead a reader.
        unmet: Math.max(0, Math.min(TARGET_PER_COUNTRY, r.candidates) - r.verified),
      })),
  };
}
