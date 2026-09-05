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
import { semanticVerdict } from './verify-semantic.mjs';

/** Verdicts. Ordered by how the caller must treat them, worst first. */
export const VERDICT = {
  REFUTED: 'refuted',
  UNREACHABLE: 'unreachable',
  NEEDS_REVIEW: 'needs-semantic-review',
  /**
   * A reader looked and did not refute it.
   *
   * Deliberately distinct from VERIFIED and deliberately weaker. VERIFIED
   * means a regex found the number in the page, which no prose can argue
   * with. This means a model read contributor-chosen text and was not
   * convinced otherwise -- and that text can contain instructions addressed
   * to the model. Capping it here is what makes a successful prompt
   * injection worthless: the best it can do is return the claim to "a human
   * should read this".
   */
  MODEL_CLEARED: 'model-cleared',
  /**
   * A reader thinks this claim is wrong. A person decides.
   *
   * Not REFUTED, and the difference is the whole point. A literal refutation
   * is a fact: the number is in the page or it is not, and no judgement is
   * involved. A semantic refutation is an opinion formed by a model reading
   * prose, and it has already been wrong about a true claim here -- Banff's
   * `clothing.policy: textile-only`, refuted first because the reader was
   * shown the wrong 6,000 characters, and again on a reading of "top is not
   * mandatory" that our own vocabulary contradicts.
   *
   * The layer was already capped so it can never approve past MODEL_CLEARED,
   * because the page is contributor-chosen. This is the symmetric cap: it can
   * never reject outright either. What it can do is stop a claim and make a
   * person look, which is the honest description of what it knows.
   */
  DISPUTED: 'disputed-by-reader',
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
export async function verifyClaims(
  overlay,
  { fetchImpl, lookup, timeoutMs, provider = null, springName = null } = {},
) {
  const results = [];
  for (const [field, claim] of Object.entries(overlay?.claims ?? {})) {
    // A retracted claim is not applied to the dataset, so verifying it would
    // spend a fetch and could log a refutation against something already
    // withdrawn.
    if (claim?.state && claim.state !== 'active') continue;

    const literal = isLiterallyVerifiable(field);

    // No reader configured and nothing literal to check: say so and stop,
    // rather than spending a fetch that decides nothing.
    if (!literal && !provider) {
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

    if (!literal) {
      let verdict;
      try {
        verdict = await semanticVerdict({
          provider, springName, field, value: claim.value, sourceText: fetched.text,
        });
      } catch (err) {
        // A provider outage is not evidence about the claim, any more than a
        // dead source is. Undecided and retryable, never a refutation.
        results.push({
          field, verdict: VERDICT.UNREACHABLE, detail: `verifier-unavailable: ${err.message}`,
        });
        continue;
      }
      if (verdict.malformed) {
        // Not an answer. Recording it as a refusal would put a false fact in
        // a permanent log; recording it as cleared would publish on a
        // non-answer. It is its own undecided outcome.
        results.push({
          field, verdict: VERDICT.UNREACHABLE, detail: 'verifier-verdict-malformed',
        });
      } else if (verdict.refuted) {
        // Routed to a person, never auto-rejected. See VERDICT.DISPUTED.
        results.push({
          field, verdict: VERDICT.DISPUTED, detail: `disputed-by-reader: ${verdict.reason}`,
        });
      } else {
        results.push({ field, verdict: VERDICT.MODEL_CLEARED, detail: verdict.reason });
      }
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
  const counts = {
    refuted: 0, disputed: 0, unreachable: 0, needsReview: 0, modelCleared: 0, verified: 0,
  };
  for (const r of results) {
    if (r.verdict === VERDICT.REFUTED) counts.refuted++;
    else if (r.verdict === VERDICT.DISPUTED) counts.disputed++;
    else if (r.verdict === VERDICT.UNREACHABLE) counts.unreachable++;
    else if (r.verdict === VERDICT.NEEDS_REVIEW) counts.needsReview++;
    else if (r.verdict === VERDICT.MODEL_CLEARED) counts.modelCleared++;
    else counts.verified++;
  }
  // 0 = nothing contradicted.
  // 1 = contradicted by its own source. Deterministic; retrying cannot change it.
  // 2 = a source could not be read. Retrying may.
  // 3 = a reader disputes it. Retrying will not help and neither will waiting;
  //     a person has to decide.
  //
  // Distinct codes so no workflow can retry a verdict into a pass, and so
  // "this is wrong" and "someone should look" are never the same signal.
  //
  // Refutation outranks a dispute: a claim contradicted by its own page is
  // wrong whatever a reader thinks of a different field. A dispute outranks
  // unreachability, because retrying resolves one and not the other.
  const code =
    counts.refuted > 0 ? 1
    : counts.disputed > 0 ? 3
    : counts.unreachable > 0 ? 2
    : 0;
  return { counts, code };
}
