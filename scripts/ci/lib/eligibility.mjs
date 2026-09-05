/**
 * May this run spend money, and has it already?
 *
 * Rule 8. Three separate questions that the spec's first draft treated as one
 * accepted residual risk, wrongly.
 *
 * ## Idempotency (F3)
 *
 * The contributor controls `gate.yml`, so they choose its trigger types.
 * Adding `reopened` means close-and-reopen fires the whole chain with no new
 * commit: unlimited spend at two clicks per cycle. A `concurrency` group does
 * not help, because the runs are sequential rather than concurrent.
 *
 * So a durable ledger keyed on `(pr, head_sha)`. On a hit, the cached verdict
 * is re-posted and the model is never called. The key is the commit, not the
 * pull request: a new push is new content and deserves a new look; reopening
 * the same commit is the same question.
 *
 * ## Budget (F4)
 *
 * Checked before the call, and a per-author daily cap on top, because one
 * author cycling many pull requests is the same attack spread wider.
 *
 * ## Durability (F8), and why this module refuses by default
 *
 * With `contents: read` the ledger cannot be a file on main. The Actions
 * cache is branch-scoped and evicts after 7 idle days, so idling the
 * repository resets the budget -- which is a spend attack by itself, not an
 * inconvenience.
 *
 * A ledger that forgets is worse than no ledger, because it looks like a
 * control. So there is no default backend: a caller must supply one, and
 * `checkEligibility` refuses to authorise spending without it. Wiring a key
 * into gate-2 without naming a durable store therefore fails closed rather
 * than quietly spending.
 */

/** Reasons a run is not allowed to spend. Compared in tests. */
export const INELIGIBLE = {
  NO_LEDGER: 'no durable ledger configured; refusing to authorise spending',
  ALREADY_REVIEWED: 'this commit has already been reviewed',
  OVER_BUDGET: 'the review budget for this period is exhausted',
  AUTHOR_CAP: 'this author has reached the daily claim cap',
  TOO_MANY_CLAIMS: 'this pull request asks for more claims than one review may spend',
};

/**
 * Budget is counted in CLAIMS, not reviews, because claims are what cost
 * money. Capping reviews was the first attempt and it was wrong by two
 * orders of magnitude: one pull request may carry 50 overlay files of 13
 * claimable fields, so a single "review" is up to 650 model calls. Fifty
 * reviews a day was a worst case of 32,500 calls -- somewhere between $488
 * and $1,950 a month against a $9 budget.
 *
 * Sized for a $9/month cap with margin. At a conservative $0.002 per claim
 * (excerpt in, one short verdict out), $9/month is about $0.30/day, or 150
 * claims. 100 leaves room for the estimate being wrong in the expensive
 * direction, which it has been before.
 *
 * MAX_CLAIMS_PER_REVIEW matters independently of the daily figure: without
 * it, one pull request exhausts a whole day in a single run, which is a
 * denial of service against every other contributor rather than a spend
 * attack against the owner.
 */
export const DEFAULT_DAILY_CLAIM_CAP = 100;
export const DEFAULT_DAILY_AUTHOR_CLAIM_CAP = 30;
export const MAX_CLAIMS_PER_REVIEW = 25;

/**
 * @param {object} args
 * @param {number} args.pr
 * @param {string} args.headSha
 * @param {string} args.author
 * @param {object|null} args.ledger      { get(key), put(key, value), countSince(prefix, since) }
 * @param {number} args.claims          how many model calls this run would make
 * @param {number} [args.authorCap]     daily claims for this author
 * @param {number} [args.totalCap]      daily claims across everyone
 * @param {number} [args.perReviewCap]
 * @param {() => Date} [args.now]
 * @returns {Promise<{ok: true} | {ok: false, reason: string, cached?: unknown}>}
 */
export async function checkEligibility({
  pr,
  headSha,
  author,
  ledger,
  claims = 0,
  authorCap = DEFAULT_DAILY_AUTHOR_CLAIM_CAP,
  totalCap = DEFAULT_DAILY_CLAIM_CAP,
  perReviewCap = MAX_CLAIMS_PER_REVIEW,
  now = () => new Date(),
}) {
  // No backend, no spending. See F8 above: this is the fail-closed default,
  // not an oversight.
  if (!ledger) return { ok: false, reason: INELIGIBLE.NO_LEDGER };

  // Keyed on the commit, not the pull request. Reopening the same commit is
  // the same question and must not buy a second call.
  const key = `review/${pr}/${headSha}`;
  const seen = await ledger.get(key);
  if (seen) return { ok: false, reason: INELIGIBLE.ALREADY_REVIEWED, cached: seen };

  // Checked before the daily figures: a single oversized run must be refused
  // outright rather than allowed to drain the day.
  if (claims > perReviewCap) {
    return { ok: false, reason: `${INELIGIBLE.TOO_MANY_CLAIMS} (${claims} > ${perReviewCap})` };
  }

  // Sums claims, not entries. Counting rows would be counting reviews again,
  // which is the mistake this whole section exists to correct.
  const since = startOfDay(now());
  const byAuthor = await ledger.countSince(`author/${author}/`, since);
  if (byAuthor + claims > authorCap) return { ok: false, reason: INELIGIBLE.AUTHOR_CAP };

  const total = await ledger.countSince('review/', since);
  if (total + claims > totalCap) return { ok: false, reason: INELIGIBLE.OVER_BUDGET };

  return { ok: true };
}

/**
 * Record that a review happened, so the next identical trigger is a cache hit.
 *
 * Written after the call rather than before, deliberately. Writing first would
 * mean a crashed run permanently marks a commit reviewed with no verdict to
 * re-post, and the contributor could never get an answer. The cost of the
 * other order is that a crash between call and write allows one repeat.
 */
export async function recordReview({
  pr, headSha, author, verdict, claims = 0, ledger, now = () => new Date(),
}) {
  if (!ledger) return;
  const at = now().toISOString();
  // `claims` is the billable unit and is what countSince sums.
  await ledger.put(`review/${pr}/${headSha}`, { at, author, verdict, claims });
  await ledger.put(`author/${author}/${pr}/${headSha}`, { at, claims });
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
