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
  AUTHOR_CAP: 'this author has reached the daily review cap',
};

/** Defaults. Deliberately small: the cost of being wrong is a drained card. */
export const DEFAULT_DAILY_AUTHOR_CAP = 10;
export const DEFAULT_DAILY_TOTAL_CAP = 50;

/**
 * @param {object} args
 * @param {number} args.pr
 * @param {string} args.headSha
 * @param {string} args.author
 * @param {object|null} args.ledger      { get(key), put(key, value), countSince(prefix, since) }
 * @param {number} [args.authorCap]
 * @param {number} [args.totalCap]
 * @param {() => Date} [args.now]
 * @returns {Promise<{ok: true} | {ok: false, reason: string, cached?: unknown}>}
 */
export async function checkEligibility({
  pr,
  headSha,
  author,
  ledger,
  authorCap = DEFAULT_DAILY_AUTHOR_CAP,
  totalCap = DEFAULT_DAILY_TOTAL_CAP,
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

  const since = startOfDay(now());
  const byAuthor = await ledger.countSince(`author/${author}/`, since);
  if (byAuthor >= authorCap) return { ok: false, reason: INELIGIBLE.AUTHOR_CAP };

  const total = await ledger.countSince('review/', since);
  if (total >= totalCap) return { ok: false, reason: INELIGIBLE.OVER_BUDGET };

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
export async function recordReview({ pr, headSha, author, verdict, ledger, now = () => new Date() }) {
  if (!ledger) return;
  const at = now().toISOString();
  await ledger.put(`review/${pr}/${headSha}`, { at, author, verdict });
  await ledger.put(`author/${author}/${pr}/${headSha}`, { at });
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
