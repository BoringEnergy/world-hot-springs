/**
 * Gate 2's PR resolution, and the three ways it is wrong if written the
 * obvious way. Each test names the finding it pins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePr, REFUSAL, checkFileListUsable, MAX_PR_FILES, API_FILE_PAGE_CAP,
} from './ci/lib/resolve-pr.mjs';

const SHA = 'a'.repeat(40);
const pull = (over = {}) => ({
  number: 7,
  state: 'open',
  head: { sha: SHA, repo: { full_name: 'stranger/world-hot-springs' } },
  ...over,
});
const resolve = (pulls, over = {}) =>
  resolvePr({
    headSha: SHA,
    headRepo: 'stranger/world-hot-springs',
    listPulls: async () => pulls,
    ...over,
  });

test('exactly one matching open PR resolves', async () => {
  assert.deepEqual(await resolve([pull()]), { ok: true, number: 7, headSha: SHA });
});

test('a commit heading another fork\'s PR does not attach that author', async () => {
  // F5, the one that matters. Fork networks share an object store, so an
  // attacker can point their branch at a commit that also heads a trusted
  // contributor's open PR. Matching on SHA alone would spend that
  // contributor's trust on a run the attacker triggered, and land the verdict
  // on their PR.
  const other = pull({ number: 99, head: { sha: SHA, repo: { full_name: 'trusted/world-hot-springs' } } });
  const out = await resolve([other]);
  assert.equal(out.ok, false);
  assert.equal(out.reason, REFUSAL.REPO_MISMATCH);
});

test('two matching open PRs refuse rather than picking one', async () => {
  const out = await resolve([pull({ number: 7 }), pull({ number: 8 })]);
  assert.equal(out.ok, false);
  assert.equal(out.reason, REFUSAL.AMBIGUOUS);
});

test('no matching PR refuses', async () => {
  assert.equal((await resolve([])).ok, false);
  assert.equal((await resolve([])).reason, REFUSAL.NONE);
});

test('a closed or merged PR on the same commit is not a match', async () => {
  // The endpoint returns merged and open PRs both for a commit off the
  // default branch. Only open ones are live submissions.
  for (const state of ['closed', 'merged']) {
    const out = await resolve([pull({ state })]);
    assert.equal(out.ok, false, `${state} must not resolve`);
  }
});

test('a different head SHA is not a match', async () => {
  // The verdict names a commit. If the PR moved, the verdict is void.
  const out = await resolve([pull({ head: { sha: 'b'.repeat(40), repo: { full_name: 'stranger/world-hot-springs' } } })]);
  assert.equal(out.ok, false);
  assert.equal(out.reason, REFUSAL.NONE);
});

test('a malformed or empty API response refuses instead of throwing', async () => {
  // pull_requests is empty for fork PRs -- the documented trap. Whatever the
  // shape, this must fail closed rather than crash the privileged workflow.
  for (const body of [null, undefined, [], [{}], [{ head: null }], [{ state: 'open' }]]) {
    const out = await resolvePr({
      headSha: SHA, headRepo: 'stranger/x', listPulls: async () => body,
    });
    assert.equal(out.ok, false, `${JSON.stringify(body)} must refuse`);
  }
});

test('a changed-file list at the API cap is refused, not trusted', async () => {
  // A PR touching more than 3000 files hides the overflow from any guard
  // built on the response, so a full page is an overflow, not an answer.
  const atCap = Array.from({ length: API_FILE_PAGE_CAP }, (_, i) => `f${i}.json`);
  const out = checkFileListUsable(atCap);
  assert.equal(out.ok, false);
  assert.match(out.reason, /cap/);
});

test('an oversized changeset is refused', () => {
  const many = Array.from({ length: MAX_PR_FILES + 1 }, (_, i) => `data/overlay/f${i}.json`);
  assert.equal(checkFileListUsable(many).ok, false);
});

test('a changeset at exactly the limit is accepted', () => {
  // The rejection test uses the limit + 1, so nothing exercises the boundary.
  // A `>` silently becoming `>=` would reject a legitimate submission.
  const exact = Array.from({ length: MAX_PR_FILES }, (_, i) => `data/overlay/f${i}.json`);
  assert.deepEqual(checkFileListUsable(exact), { ok: true });
});
