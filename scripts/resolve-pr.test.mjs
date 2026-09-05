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

test('the file-count limit is a rule about contributions, not about maintainers', () => {
  // Gate 2's first live run refused a maintainer pull request, because the
  // path guard and this cap were applied to everyone. Both exist to stop a
  // stranger editing the pipeline that reviews them; neither describes an
  // ordinary change to src/.
  const many = Array.from({ length: MAX_PR_FILES + 1 }, (_, i) => `src/f${i}.ts`);
  assert.equal(checkFileListUsable(many, { enforceCountLimit: false }).ok, true);
  assert.equal(checkFileListUsable(many, { enforceCountLimit: true }).ok, false);
});

test('the API cap is enforced regardless of who sent the pull request', () => {
  // Not part of that scoping: it asks whether the list can be seen in full,
  // which is a fact about the response. A truncated list silently narrows
  // every check built on it, maintainer or not.
  const atCap = Array.from({ length: API_FILE_PAGE_CAP }, (_, i) => `f${i}.json`);
  assert.equal(checkFileListUsable(atCap, { enforceCountLimit: false }).ok, false);
});

test('the strict limit is the default when a caller says nothing', () => {
  // A caller that forgets to think about it must get the safe behaviour.
  const many = Array.from({ length: MAX_PR_FILES + 1 }, (_, i) => `data/overlay/f${i}.json`);
  assert.equal(checkFileListUsable(many).ok, false);
});

test('a fork pull request resolves from the open-PR list', () => {
  // The regression that only a real fork PR exposed. The spec prescribed
  // GET /repos/{base}/commits/{sha}/pulls, which returns [] for a fork's head
  // commit because that commit is not in the base repository's ref namespace.
  // Gate 2 refused a live fork PR with "no open pull request has this head
  // commit" while the PR was open. Fail-closed, so safe; also useless.
  const forkPull = {
    number: 23,
    state: 'open',
    head: { sha: SHA, repo: { full_name: 'contributor/world-hot-springs' } },
  };
  return resolvePr({
    headSha: SHA,
    headRepo: 'contributor/world-hot-springs',
    listPulls: async () => [forkPull],
  }).then((out) => {
    assert.deepEqual(out, { ok: true, number: 23, headSha: SHA });
  });
});

test('a fork PR is not confused with a same-repo PR on the same commit', () => {
  // Both are open, both have this head SHA. Only the head repository tells
  // them apart, and picking wrong attaches the verdict to the wrong PR.
  const pulls = [
    { number: 23, state: 'open', head: { sha: SHA, repo: { full_name: 'contributor/world-hot-springs' } } },
    { number: 24, state: 'open', head: { sha: SHA, repo: { full_name: 'BoringEnergy/world-hot-springs' } } },
  ];
  return resolvePr({
    headSha: SHA, headRepo: 'contributor/world-hot-springs', listPulls: async () => pulls,
  }).then((out) => {
    assert.deepEqual(out, { ok: true, number: 23, headSha: SHA });
  });
});

test('unrelated open pull requests are ignored, not counted as ambiguity', () => {
  // The open-PR list contains every live PR, so most entries are noise. If
  // they were treated as candidates the gate would refuse as AMBIGUOUS
  // whenever two PRs happened to be open at once.
  const pulls = [
    { number: 1, state: 'open', head: { sha: 'c'.repeat(40), repo: { full_name: 'x/y' } } },
    { number: 2, state: 'open', head: { sha: 'd'.repeat(40), repo: { full_name: 'z/w' } } },
    { number: 23, state: 'open', head: { sha: SHA, repo: { full_name: 'contributor/world-hot-springs' } } },
  ];
  return resolvePr({
    headSha: SHA, headRepo: 'contributor/world-hot-springs', listPulls: async () => pulls,
  }).then((out) => assert.equal(out.number, 23));
});
