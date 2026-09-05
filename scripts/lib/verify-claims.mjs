/**
 * Does the cited page actually support the claimed value?
 *
 * The gate has never asked this. `validate-overlay.mjs` checks shape, field
 * allowlists, ranges and paths -- everything except whether the claim is
 * true. An agent could submit `temperature.celsius: 55` citing a real, public,
 * https page that says nothing of the kind and the gate passed it. On a 90C
 * spring that is a burn.
 *
 * ## Why only numbers are verified literally
 *
 * A claim's value is often not a string that appears on the page:
 *
 *   temperature.celsius  38.5                      appears verbatim
 *   location.elevation   1580                      appears verbatim
 *   hours.status         "open"                    our enum, never the page's word
 *   clothing.policy      "textile-only"            our vocabulary, invented here
 *   access.price         "Adult $19.75"            a human summary of a price table
 *   hours.seasonalNotes  "Open all year; Parco..." a paraphrase by construction
 *
 * Matching those literally would refute true claims at a high rate, and a
 * refutation is written to a permanent public log. A false entry there is
 * worse than no entry: it is a durable, citable accusation that a correct
 * contribution was wrong. So non-literal fields are reported as
 * `needs-semantic-review` -- explicitly NOT verified, never silently passed.
 *
 * That split is not a consolation prize. The literally-verifiable fields are
 * the numeric ones, and the numeric ones are where being wrong hurts a body.
 * The deterministic half covers the dangerous half.
 *
 * ## Why transient failure is not refutation
 *
 * A source being down says nothing about the claim. Collapsing "the page
 * disagrees" and "the page did not load" into one failure would let an
 * afternoon of DNS trouble write refutations against honest contributors.
 * They are separate verdicts with separate exit codes, so CI can retry one
 * and must never retry the other.
 */
import { fetchSource, valueAppears } from './verify-source.mjs';
import { FIELD_TYPES } from './overlay.mjs';

/** Verdicts. Ordered by how the caller must treat them, worst first. */
export const VERDICT = {
  REFUTED: 'refuted',
  UNREACHABLE: 'unreachable',
  NEEDS_REVIEW: 'needs-semantic-review',
  VERIFIED: 'verified',
};

/** Outcomes from fetchSource that mean "we never saw the page". */
const TRANSIENT = new Set(['source-unreachable', 'source-too-large']);

/**
 * Is this field's value expected to appear verbatim in the source text?
 *
 * Driven off FIELD_TYPES rather than a second hand-kept list, so a new
 * numeric field is covered the day it is added and cannot be forgotten here.
 * An array of allowed values in FIELD_TYPES is an enum -- our vocabulary,
 * not the page's.
 */
export function isLiterallyVerifiable(field) {
  return FIELD_TYPES[field] === 'number';
}

/**
 * Verify one overlay file's claims.
 *
 * @returns {Promise<Array<{field: string, verdict: string, detail?: string}>>}
 */
export async function verifyClaims(overlay, { fetchImpl, lookup, timeoutMs } = {}) {
  const results = [];
  for (const [field, claim] of Object.entries(overlay?.claims ?? {})) {
    // A retracted claim is not applied to the dataset, so verifying it would
    // spend a fetch and could log a refutation against something already
    // withdrawn.
    if (claim?.state && claim.state !== 'active') continue;

    if (!isLiterallyVerifiable(field)) {
      results.push({
        field,
        verdict: VERDICT.NEEDS_REVIEW,
        detail: `${field} is not a value that appears verbatim in a source; a reader must judge it`,
      });
      continue;
    }

    const fetched = await fetchSource(claim.source, { fetchImpl, lookup, timeoutMs });
    if (!fetched.ok) {
      results.push({
        field,
        verdict: TRANSIENT.has(fetched.outcome) ? VERDICT.UNREACHABLE : VERDICT.REFUTED,
        detail: fetched.outcome,
      });
      continue;
    }

    if (valueAppears(claim.value, fetched.text)) {
      results.push({ field, verdict: VERDICT.VERIFIED });
    } else {
      results.push({
        field,
        verdict: VERDICT.REFUTED,
        detail: `value-absent-from-source: ${JSON.stringify(claim.value)} does not appear at ${claim.source}`,
      });
    }
  }
  return results;
}

/**
 * Collapse many results into one exit decision.
 *
 * Refutation outranks unreachability: if one claim is provably wrong, the
 * submission is wrong, and a second claim's flaky host does not soften that.
 */
export function summarise(results) {
  const counts = { refuted: 0, unreachable: 0, needsReview: 0, verified: 0 };
  for (const r of results) {
    if (r.verdict === VERDICT.REFUTED) counts.refuted++;
    else if (r.verdict === VERDICT.UNREACHABLE) counts.unreachable++;
    else if (r.verdict === VERDICT.NEEDS_REVIEW) counts.needsReview++;
    else counts.verified++;
  }
  // 1 = reject, this is wrong. 2 = undecided, safe to retry. 0 = nothing
  // contradicted. Distinct codes so a workflow cannot retry a refutation into
  // a pass by running it again.
  const code = counts.refuted > 0 ? 1 : counts.unreachable > 0 ? 2 : 0;
  return { counts, code };
}
