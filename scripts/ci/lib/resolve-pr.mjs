/**
 * Which pull request did this workflow_run belong to?
 *
 * Sounds like bookkeeping. It is the security-critical step, and the spec
 * (2026-08-25-gate-2-trigger-security.md, finding F5) records three ways the
 * obvious implementations are wrong:
 *
 *   `event.workflow_run.pull_requests[0]` is EMPTY for fork PRs. Code reading
 *   it works against same-repo branches and silently fails for exactly the
 *   population this gate exists to police.
 *
 *   Resolving by SHA instead returns an ARRAY, and for a commit off the
 *   default branch it includes merged and open PRs both.
 *
 *   Fork networks share an object store. An attacker can point their branch
 *   at a commit that also heads someone else's open PR. Taking [0] attaches a
 *   trusted author to a run the attacker triggered -- spending that author's
 *   trust, and landing the verdict on their PR.
 *
 * So: accept exactly one open PR whose head SHA matches AND whose head repo
 * matches. Zero, or more than one, or any mismatch -- refuse and let a human
 * look. Fail closed, every time.
 *
 * Pure and injectable so the refusals can be tested without a network.
 */

/** Why a resolution was refused. Strings are compared in tests. */
export const REFUSAL = {
  NONE: 'no open pull request has this head commit',
  AMBIGUOUS: 'more than one open pull request has this head commit',
  REPO_MISMATCH: 'the pull request head repository does not match the run',
};

/**
 * @param {object} args
 * @param {string} args.headSha        workflow_run.head_sha
 * @param {string} args.headRepo       workflow_run.head_repository.full_name
 * @param {() => Promise<Array>} args.listPulls  GET /commits/{sha}/pulls
 * @returns {Promise<{ok: true, number: number, headSha: string} | {ok: false, reason: string}>}
 */
export async function resolvePr({ headSha, headRepo, listPulls }) {
  const pulls = (await listPulls()) ?? [];

  const candidates = pulls.filter(
    (p) =>
      p?.state === 'open' &&
      // Both conditions, not either. The SHA alone is the shared-object-store
      // hole: it can legitimately belong to a PR from a different fork.
      p?.head?.sha === headSha &&
      p?.head?.repo?.full_name === headRepo,
  );

  if (candidates.length === 1) {
    return { ok: true, number: candidates[0].number, headSha };
  }
  if (candidates.length > 1) return { ok: false, reason: REFUSAL.AMBIGUOUS };

  // Distinguish "nothing matched at all" from "something matched the SHA but
  // came from another repository". The second is the attack shape and a
  // maintainer should be able to see that it happened.
  const shaOnly = pulls.filter((p) => p?.state === 'open' && p?.head?.sha === headSha);
  return { ok: false, reason: shaOnly.length ? REFUSAL.REPO_MISMATCH : REFUSAL.NONE };
}

/**
 * A changed-file list is only trustworthy if we can see all of it.
 *
 * GitHub returns at most 3000 files from the files endpoint. A PR touching
 * more hides the overflow from any guard built on the response, so a
 * full-looking page is treated as an overflow rather than as a complete
 * answer. And a data-correction atlas has no legitimate 50-file pull request,
 * let alone 3000.
 */
export const API_FILE_PAGE_CAP = 3000;
export const MAX_PR_FILES = 50;

export function checkFileListUsable(files) {
  if (files.length >= API_FILE_PAGE_CAP) {
    return { ok: false, reason: `changed-file list is at the API cap (${API_FILE_PAGE_CAP}); it cannot be seen in full` };
  }
  if (files.length > MAX_PR_FILES) {
    return { ok: false, reason: `${files.length} files changed, limit is ${MAX_PR_FILES}` };
  }
  return { ok: true };
}
