/**
 * The three things that must exist before Gate 2 may hold a key.
 *
 * Each pins a specific finding from the security spec, and each test names
 * the one it pins. They are written against the findings rather than against
 * the implementation, so a rewrite that reintroduces the hole fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertPristine } from './ci/lib/pristine.mjs';
import { fetchContributorFiles, MAX_CONTRIB_BYTES } from './ci/lib/fetch-contrib.mjs';
import {
  checkEligibility, recordReview, INELIGIBLE,
  DEFAULT_DAILY_CLAIM_CAP, DEFAULT_DAILY_AUTHOR_CLAIM_CAP, MAX_CLAIMS_PER_REVIEW,
} from './ci/lib/eligibility.mjs';

// --- 1. assert-checkout-pristine (F1) --------------------------------------

const gitStub = (map) => (args) => {
  const cmd = args.join(' ');
  if (cmd in map) return map[cmd];
  throw new Error(`unexpected git ${cmd}`);
};

test('a clean checkout at the expected ref passes', () => {
  const git = gitStub({
    'status --porcelain --untracked-files=all': '\n',
    'rev-parse HEAD': 'abc123\n',
    'rev-parse origin/main': 'abc123\n',
  });
  assert.deepEqual(assertPristine({ git, expectedRef: 'origin/main' }), { ok: true });
});

test('a modified trusted script fails, which is finding F1', () => {
  // The spec's first draft fetched contributor files to their repo-relative
  // paths, so a PR containing scripts/ci/manager.mjs overwrote the trusted
  // script the next step ran with the key in scope. This is the assertion
  // that catches it having happened.
  const git = gitStub({
    'status --porcelain --untracked-files=all': ' M scripts/ci/manager.mjs\n',
    'rev-parse HEAD': 'abc123\n',
    'rev-parse origin/main': 'abc123\n',
  });
  const out = assertPristine({ git, expectedRef: 'origin/main' });
  assert.equal(out.ok, false);
  assert.match(out.reason, /manager\.mjs/);
});

test('an untracked file dropped into the checkout fails', () => {
  // Ignoring untracked entries would miss a file written at a path nothing
  // tracks, which is the same attack with a new filename.
  const git = gitStub({
    'status --porcelain --untracked-files=all': '?? scripts/ci/evil.mjs\n',
    'rev-parse HEAD': 'abc123\n',
    'rev-parse origin/main': 'abc123\n',
  });
  assert.equal(assertPristine({ git, expectedRef: 'origin/main' }).ok, false);
});

test('a clean tree at the wrong commit still fails', () => {
  // `ref:` in the workflow is only as good as the event payload that filled
  // it. Clean but wrong is still the wrong code.
  const git = gitStub({
    'status --porcelain --untracked-files=all': '',
    'rev-parse HEAD': 'deadbee\n',
    'rev-parse origin/main': 'abc123\n',
  });
  const out = assertPristine({ git, expectedRef: 'origin/main' });
  assert.equal(out.ok, false);
  assert.match(out.reason, /expected origin\/main/);
});

test('a git failure fails closed, never open', () => {
  const git = () => { throw new Error('not a repository'); };
  assert.equal(assertPristine({ git, expectedRef: 'origin/main' }).ok, false);
});

// --- 2. content-hash fetch into a directory we chose (rule 3) ---------------

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prereq-'));
const okRes = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => body });

test('a fetched file is named by its content, never by its path', async () => {
  // `filename` is attacker-controlled text. Using it as a path component is
  // how a PR overwrites a trusted script.
  const dir = tmpdir();
  const out = await fetchContributorFiles(
    [{ filename: '../../scripts/ci/gate-2.mjs', raw_url: 'https://x/1' }],
    { dir, fetchImpl: async () => okRes('{"id":"whs_000000000001"}') },
  );
  assert.equal(out.ok, true);
  const written = fs.readdirSync(dir);
  assert.equal(written.length, 1);
  assert.match(written[0], /^[0-9a-f]{64}\.json$/, 'named by sha256 of the content');
  assert.equal(out.files[0].label, '../../scripts/ci/gate-2.mjs', 'the name survives as a label only');
});

test('nothing is written outside the directory we chose', async () => {
  const dir = tmpdir();
  await fetchContributorFiles(
    [{ filename: '/etc/passwd', raw_url: 'https://x/1' },
     { filename: 'C:\\Windows\\System32\\x', raw_url: 'https://x/2' }],
    { dir, fetchImpl: async () => okRes('{}') },
  );
  for (const f of fs.readdirSync(dir)) {
    assert.match(f, /^[0-9a-f]{64}\.json$/, `${f} is not a content hash`);
  }
});

test('identical content lands in one file, not two', async () => {
  // A pull request with the same claim twice is one download and one path.
  const dir = tmpdir();
  const out = await fetchContributorFiles(
    [{ filename: 'a.json', raw_url: 'https://x/1' }, { filename: 'b.json', raw_url: 'https://x/2' }],
    { dir, fetchImpl: async () => okRes('{"same":true}') },
  );
  assert.equal(out.ok, true);
  assert.equal(fs.readdirSync(dir).length, 1);
});

test('an oversized file is rejected, never truncated', async () => {
  // Truncation lets whoever wrote the file choose where the evidence stops,
  // which is an injection primitive rather than a size control. Finding F4:
  // overlay JSON is attacker-written and can be megabytes of valid JSON.
  const dir = tmpdir();
  const huge = 'x'.repeat(MAX_CONTRIB_BYTES + 1);
  const out = await fetchContributorFiles(
    [{ filename: 'big.json', raw_url: 'https://x/1' }],
    { dir, fetchImpl: async () => okRes(huge) },
  );
  assert.equal(out.ok, false);
  assert.match(out.reason, /cap is/);
  assert.equal(fs.readdirSync(dir).length, 0, 'nothing partial is left behind');
});

test('a lying content-length is caught by the second check', async () => {
  const dir = tmpdir();
  const out = await fetchContributorFiles(
    [{ filename: 'big.json', raw_url: 'https://x/1' }],
    {
      dir,
      fetchImpl: async () => ({
        ok: true, status: 200,
        headers: { get: () => '10' },
        text: async () => 'x'.repeat(MAX_CONTRIB_BYTES + 1),
      }),
    },
  );
  assert.equal(out.ok, false);
});

// --- 3. eligibility, idempotency and budget (F3, F4, F8) -------------------

function memoryLedger() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.get(k) ?? null; },
    async put(k, v) { store.set(k, v); },
    // Sums claims, matching the real ledger. Counting rows here would let
    // the tests pass against a ledger that budgets in the wrong unit, which
    // is the defect this whole section exists to correct.
    async countSince(prefix, since) {
      let n = 0;
      for (const [k, v] of store) {
        if (k.startsWith(prefix) && new Date(v.at) >= since) n += v.claims ?? 0;
      }
      return n;
    },
  };
}

const base = { pr: 7, headSha: 'a'.repeat(40), author: 'stranger' };

test('without a durable ledger, nothing may spend', async () => {
  // Finding F8. With contents: read the ledger cannot live on main, and the
  // Actions cache evicts after 7 idle days and is branch-scoped -- so idling
  // the repository would reset the budget, which is a spend attack by itself.
  // A ledger that forgets is worse than none, because it looks like a
  // control. So there is no default backend and this fails closed.
  const out = await checkEligibility({ ...base, ledger: null });
  assert.equal(out.ok, false);
  assert.equal(out.reason, INELIGIBLE.NO_LEDGER);
});

test('the same commit is never reviewed twice', async () => {
  // Finding F3. The contributor controls gate.yml and can add `reopened`, so
  // close-and-reopen fires the whole chain with no new commit: unlimited
  // spend at two clicks per cycle. The cached verdict is returned instead.
  const ledger = memoryLedger();
  assert.equal((await checkEligibility({ ...base, ledger })).ok, true);
  await recordReview({ ...base, verdict: { code: 0 }, ledger });

  const again = await checkEligibility({ ...base, ledger });
  assert.equal(again.ok, false);
  assert.equal(again.reason, INELIGIBLE.ALREADY_REVIEWED);
  assert.deepEqual(again.cached.verdict, { code: 0 }, 're-post rather than re-spend');
});

test('a new commit on the same pull request is a new question', async () => {
  // Keyed on the commit, not the PR: new content deserves a new look.
  const ledger = memoryLedger();
  await recordReview({ ...base, verdict: { code: 0 }, ledger });
  const pushed = await checkEligibility({ ...base, headSha: 'b'.repeat(40), ledger });
  assert.equal(pushed.ok, true);
});

test('the budget is counted in claims, not reviews', () => {
  // The mistake this replaced. One pull request may carry 50 overlay files of
  // 13 claimable fields, so one "review" is up to 650 model calls. Capping
  // reviews at 50/day was a worst case of 32,500 calls -- between $488 and
  // $1,950 a month against a $9 budget.
  assert.ok(MAX_CLAIMS_PER_REVIEW < 50 * 13, 'one review must not be able to spend a whole day');
  assert.ok(DEFAULT_DAILY_CLAIM_CAP <= 150, 'sized for $9/month at $0.002 a claim');
});

test('one oversized pull request is refused before the daily figures', async () => {
  // Without this, a single PR drains the day in one run -- a denial of
  // service against every other contributor, not only a spend attack.
  const ledger = memoryLedger();
  const out = await checkEligibility({ ...base, ledger, claims: MAX_CLAIMS_PER_REVIEW + 1 });
  assert.equal(out.ok, false);
  assert.match(out.reason, /more claims than one review may spend/);
});

test('an author daily claims accumulate across pull requests', async () => {
  const ledger = memoryLedger();
  await recordReview({
    pr: 1, headSha: 'a'.repeat(40), author: 'stranger', verdict: {},
    claims: DEFAULT_DAILY_AUTHOR_CLAIM_CAP, ledger,
  });
  const out = await checkEligibility({
    pr: 99, headSha: 'c'.repeat(40), author: 'stranger', ledger, claims: 1,
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, INELIGIBLE.AUTHOR_CAP);
});

test('a run that would cross the cap is refused, not truncated', async () => {
  // `total + claims > cap` rather than `total >= cap`: a run is authorised
  // for what it will actually spend, so it cannot start under and finish over.
  const ledger = memoryLedger();
  await recordReview({ pr: 1, headSha: 'a'.repeat(40), author: 'x', verdict: {}, claims: 95, ledger });
  const out = await checkEligibility({
    pr: 8, headSha: 'e'.repeat(40), author: 'other', ledger, claims: 10, totalCap: 100,
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, INELIGIBLE.OVER_BUDGET);
});

test('one author does not exhaust another', async () => {
  const ledger = memoryLedger();
  await recordReview({
    pr: 1, headSha: 'f'.repeat(40), author: 'noisy', verdict: {},
    claims: DEFAULT_DAILY_AUTHOR_CLAIM_CAP, ledger,
  });
  const out = await checkEligibility({
    pr: 99, headSha: 'c'.repeat(40), author: 'quiet', ledger, claims: 5,
  });
  assert.equal(out.ok, true);
});

test('yesterday\'s reviews do not count against today', async () => {
  const ledger = memoryLedger();
  const yesterday = new Date('2026-09-04T12:00:00Z');
  await recordReview({ ...base, verdict: {}, claims: 30, ledger, now: () => yesterday });
  const out = await checkEligibility({
    pr: 8, headSha: 'd'.repeat(40), author: 'stranger', ledger,
    claims: 5, authorCap: 10, now: () => new Date('2026-09-05T12:00:00Z'),
  });
  assert.equal(out.ok, true);
});
