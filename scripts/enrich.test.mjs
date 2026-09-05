import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  attempt, runPlan, flagValue, sourceExcerpt, searchQuery,
  SOURCE_EXCERPT_CHARS, PROPOSER_SYSTEM, VERIFIER_SYSTEM, MAX_URLS_PER_SPRING,
  NUMERIC_FIELDS, LITERAL_FIELDS,
} from './enrich.mjs';
import { validateOverlay, FIELD_TYPES } from './lib/overlay.mjs';
import { valueAppears } from './lib/verify-source.mjs';
import { RateLimitedError } from './lib/providers/gateway.mjs';

/** See verify-source.test.mjs: keeps these tests off live DNS. */
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const NOW = () => '2026-08-29T12:00:00.000Z';

/**
 * Every path is a fresh temp directory. data/overlay is the only irreplaceable
 * layer in the repository, so no test may name a path inside it -- not even
 * one it intends to clean up, since a killed runner never reaches `finally`.
 */
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-'));
  return {
    overlayDir: path.join(dir, 'overlay'),
    refutationsFile: path.join(dir, 'refutations.jsonl'),
    coverageFile: path.join(dir, 'coverage.json'),
  };
}

/**
 * Search and fetch are both stubbed in every test here.
 *
 * TinyFish is a shared, rate-limited service and the gateway costs money; a
 * suite that reached either would be a bill and a flake rather than a test.
 */
const found = (...urls) => async () => urls.map((url) => ({ title: url, url, snippet: '' }));
const oneResult = found('https://example.org/a');
const PAGE = '<html><body>The water at A is 42.5 degrees.</body></html>';
const serving = (html = PAGE) => async () => ({ ok: true, text: async () => html });

/** A proposer that always returns nothing, which is the correct answer. */
const silent = { complete: async () => ({ claims: {} }) };
const springs = [
  { id: 'whs_00000000000a', name: 'A', location: { country: 'CL' } },
  { id: 'whs_00000000000b', name: 'B', location: { country: 'CL' } },
];
const byId = new Map(springs.map((s) => [s.id, s]));
const knownIds = new Set(byId.keys());
const plan = [{ country: 'CL', candidates: ['whs_00000000000a', 'whs_00000000000b'] }];
const roles = { proposer: 'a:1', verifier: 'b:1' };

/** The stubs every test shares unless it is specifically about one of them. */
const wired = { searchImpl: oneResult, lookupImpl: publicLookup, fetchImpl: serving() };

/** Lines of the refutation log, parsed. */
function refutations(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('a spring with no findable sources produces zero files', async () => {
  // The spec calls this the most important test here. The characteristic
  // failure of an enrichment agent is inventing a plausible value rather than
  // returning nothing, so "no file" must be a first-class outcome.
  const paths = tmp();
  const results = await runPlan({
    plan, byId, knownIds, roles,
    providers: { proposer: silent, verifier: silent }, ...paths, ...wired, now: NOW,
  });
  assert.equal(fs.existsSync(paths.overlayDir), false, 'no overlay directory should be created');
  assert.equal(results[0].verified, 0);
  assert.equal(results[0].attempted, 2);
  // The attempt must still be recorded, or "tried and got nothing" is
  // indistinguishable from "never tried" on the next run.
  assert.deepEqual(
    refutations(paths.refutationsFile).map((r) => r.outcome),
    ['no-claim-proposed', 'no-claim-proposed'],
  );
});

test('a country reports unmet rather than being skipped silently', async () => {
  const paths = tmp();
  const results = await runPlan({
    plan, byId, knownIds, roles,
    providers: { proposer: silent, verifier: silent }, ...paths, ...wired, now: NOW,
    // The coverage map is only written on a full run, and this assertion is
    // about what that map says.
    writeCoverage: true,
  });
  const cov = JSON.parse(fs.readFileSync(paths.coverageFile, 'utf8'));
  assert.equal(cov.countries.length, 1, 'the country must appear in coverage, not vanish');
  assert.equal(cov.countries[0].country, 'CL');
  assert.equal(cov.countries[0].unmet, 2);
  assert.equal(results.length, 1, 'the country must appear in the results, not vanish');
});

test('an existing overlay file is never re-proposed and counts toward the target', async () => {
  const paths = tmp();
  fs.mkdirSync(paths.overlayDir, { recursive: true });
  fs.writeFileSync(path.join(paths.overlayDir, 'whs_00000000000a.json'), '{}');
  let calls = 0;
  const counting = { complete: async () => { calls++; return { claims: {} }; } };
  const results = await runPlan({
    plan, byId, knownIds, roles,
    providers: { proposer: counting, verifier: counting }, ...paths, ...wired, now: NOW,
  });
  // Counted as alreadyHad, not verified. The distinction is what stops
  // coverage.json reporting a country as met by this run when the claims were
  // already on disk -- under a `measures` string promising it reports what
  // this run could verify.
  assert.equal(results[0].alreadyHad, 1, 'the existing file must count toward the target');
  assert.equal(results[0].verified, 0, 'but not as work this run did');
  assert.equal(results[0].attempted, 1, 'only the second candidate may be attempted');
  assert.equal(calls, 1, 'only the second candidate may be proposed');
});

test('a spring that yields nothing is not re-proposed on the next run', async () => {
  // The proposer returning {claims:{}} is the correct and expected outcome, and
  // it leaves no overlay file. Without a refutation record marking the attempt,
  // every resumption re-pays for exactly the springs that have no sources --
  // which are the ones each restart reaches first.
  const paths = tmp();
  let calls = 0;
  const counting = { complete: async () => { calls++; return { claims: {} }; } };
  const args = {
    plan, byId, knownIds, roles,
    providers: { proposer: counting, verifier: counting }, ...paths, ...wired, now: NOW,
  };
  await runPlan(args);
  const afterFirst = calls;
  assert.ok(afterFirst > 0, 'the first run must actually propose');
  const second = await runPlan(args);
  assert.equal(calls, afterFirst, 'the second run must propose nothing');
  assert.equal(second[0].attempted, 0, 'and must report the springs as not attempted again');
});

test('--retry-refuted re-proposes a spring an earlier run gave up on', async () => {
  // The skip is a default, not a policy: sources appear, and a different
  // provider pair may succeed where this one did not.
  const paths = tmp();
  let calls = 0;
  const counting = { complete: async () => { calls++; return { claims: {} }; } };
  const args = {
    plan, byId, knownIds, roles,
    providers: { proposer: counting, verifier: counting }, ...paths, ...wired, now: NOW,
  };
  await runPlan(args);
  const afterFirst = calls;
  const second = await runPlan({ ...args, retryRefuted: true });
  assert.equal(calls, afterFirst * 2, 'every candidate must be proposed again');
  assert.equal(second[0].attempted, 2);
});

test('a filtered run leaves the coverage map alone', async () => {
  const paths = tmp();
  fs.writeFileSync(paths.coverageFile, '{"sentinel":true}');
  await runPlan({
    plan, byId, knownIds, roles,
    providers: { proposer: silent, verifier: silent }, ...paths, ...wired, now: NOW,
    writeCoverage: false,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.coverageFile, 'utf8')), { sentinel: true });
});

test('end to end, a verified claim produces a file that validateOverlay accepts', async () => {
  const paths = tmp();
  // No `source` in the proposal: the citation is the URL we fetched, not one
  // the model recalled. That is the whole shape of the inverted flow.
  const proposer = { complete: async () => ({
    claims: { 'temperature.celsius': { value: 42.5 } },
  }) };
  const verifier = { complete: async () => ({ refuted: false, reason: 'stated plainly' }) };
  const fetched = [];
  const fetchImpl = async (url) => { fetched.push(url); return { ok: true, text: async () => PAGE }; };

  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW,
    searchImpl: oneResult, fetchImpl,
  });

  // Without this the pipeline could be reading nothing at all and the rest of
  // the assertions would still hold: they would be testing the stub proposer.
  assert.deepEqual(fetched, ['https://example.org/a'], 'the searched source must actually be fetched');

  const file = path.join(paths.overlayDir, 'whs_00000000000a.json');
  assert.ok(fs.existsSync(file), 'a verified claim must produce a file');
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(written.id, 'whs_00000000000a');
  assert.equal(written.claims['temperature.celsius'].value, 42.5);
  assert.equal(written.claims['temperature.celsius'].source, 'https://example.org/a',
    'the recorded citation must be the URL whose text was checked');
  assert.equal(written.claims['temperature.celsius'].state, 'active');
  assert.equal(written.claims['temperature.celsius'].contributor, 'a:1',
    'the provider must be recorded, since that is the benchmark');

  // The gate this file has to survive is scripts/validate-overlay.mjs, which
  // is validateOverlay plus a filename check. The CLI itself only looks inside
  // data/overlay -- the one directory a test may not write to -- so its two
  // checks are applied here directly rather than by shelling out to it.
  assert.deepEqual(validateOverlay(written, { knownIds }), []);
  assert.equal(path.basename(file), `${written.id}.json`);
});

test('a value the source does not state is refuted, and writes no file', async () => {
  // The deterministic half of verification. A verifier that says "not refuted"
  // must not be able to carry a claim the page never made.
  const paths = tmp();
  const proposer = { complete: async () => ({
    claims: { 'temperature.celsius': { value: 42.5 } },
  }) };
  const verifier = { complete: async () => ({ refuted: false, reason: 'looks fine to me' }) };

  const results = await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW,
    searchImpl: oneResult, lookupImpl: publicLookup, fetchImpl: serving('<html><body>The water at A is pleasant.</body></html>'),
  });

  assert.equal(fs.existsSync(paths.overlayDir), false, 'no overlay directory should be created');
  assert.equal(results[0].verified, 0);
  assert.deepEqual(
    refutations(paths.refutationsFile).map((r) => r.outcome),
    ['value-absent-from-source'],
  );
});

test('a field withheld from agents is recorded, not silently dropped', async () => {
  const paths = tmp();
  const proposer = { complete: async () => ({ claims: { name: { value: 'Renamed' } } }) };
  const verifier = { complete: async () => { throw new Error('the verifier must never be reached'); } };

  const results = await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, ...wired, now: NOW,
  });

  assert.equal(fs.existsSync(paths.overlayDir), false);
  assert.equal(results[0].verified, 0);
  const log = refutations(paths.refutationsFile);
  assert.equal(log.length, 1);
  assert.equal(log[0].outcome, 'field-not-agent-claimable');
  assert.equal(log[0].field, 'name');
});

test('a verifier that refuses the claim writes no file', async () => {
  const paths = tmp();
  const proposer = { complete: async () => ({
    claims: { 'temperature.celsius': { value: 42.5 } },
  }) };
  const verifier = { complete: async () => ({ refuted: true, reason: 'a different pool' }) };

  const results = await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, ...wired, now: NOW,
  });

  assert.equal(fs.existsSync(paths.overlayDir), false);
  assert.equal(results[0].verified, 0);
  assert.deepEqual(
    refutations(paths.refutationsFile).map((r) => r.outcome),
    ['refuted-by-verifier'],
  );
});

test('a search result that is not a fetchable URL is recorded with the reason', async () => {
  const paths = tmp();
  const proposer = { complete: async () => { throw new Error('the proposer must never be reached'); } };
  const verifier = { complete: async () => { throw new Error('the verifier must never be reached'); } };

  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW,
    searchImpl: found('ftp://example.org/a'),
    lookupImpl: publicLookup, fetchImpl: async () => { throw new Error('a refused scheme must never be fetched'); },
  });

  assert.equal(fs.existsSync(paths.overlayDir), false);
  // The four-way source split exists so a fabricated URL is distinguishable
  // from a page that is merely large; collapsing them loses the whole point.
  assert.deepEqual(
    refutations(paths.refutationsFile).map((r) => r.outcome),
    ['source-malformed'],
  );
});

test('an overlay the validator refuses is discarded and recorded', async () => {
  // 900 C is outside validateOverlay's range, so the claim survives the
  // fetch-check and the verifier and is then thrown out at the gate. Without a
  // record, the same unusable overlay is proposed and paid for on every restart.
  const paths = tmp();
  const proposer = { complete: async () => ({
    claims: { 'temperature.celsius': { value: 900 } },
  }) };
  const verifier = { complete: async () => ({ refuted: false, reason: 'stated plainly' }) };

  const results = await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW,
    searchImpl: oneResult, lookupImpl: publicLookup, fetchImpl: serving('<html><body>The water at A is 900 degrees.</body></html>'),
  });

  assert.equal(fs.existsSync(paths.overlayDir), false, 'an invalid overlay must not be written');
  assert.equal(results[0].verified, 0);
  assert.deepEqual(
    refutations(paths.refutationsFile).map((r) => r.outcome),
    ['overlay-rejected'],
  );
});

test('the target stops the run before the candidate list is exhausted', async () => {
  // TARGET_PER_COUNTRY is 2; a third candidate must never be paid for.
  const paths = tmp();
  const wide = [
    ...springs,
    { id: 'whs_00000000000c', name: 'C', location: { country: 'CL' } },
  ];
  const wideById = new Map(wide.map((s) => [s.id, s]));
  let calls = 0;
  const proposer = { complete: async () => {
    calls++;
    return { claims: { 'temperature.celsius': { value: 42.5 } } };
  } };
  const verifier = { complete: async () => ({ refuted: false, reason: 'stated plainly' }) };

  const results = await runPlan({
    plan: [{ country: 'CL', candidates: wide.map((s) => s.id) }],
    byId: wideById, knownIds: new Set(wideById.keys()), roles,
    providers: { proposer, verifier }, ...paths, ...wired, now: NOW,
  });

  assert.equal(results[0].verified, 2);
  assert.equal(calls, 2, 'the third candidate must not be proposed');
  assert.equal(fs.existsSync(path.join(paths.overlayDir, 'whs_00000000000c.json')), false);
});

test('a candidate id absent from the dataset is skipped without spending', async () => {
  const paths = tmp();
  let calls = 0;
  const counting = { complete: async () => { calls++; return { claims: {} }; } };
  const results = await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_0000000000ff'] }],
    byId, knownIds, roles,
    providers: { proposer: counting, verifier: counting }, ...paths, ...wired, now: NOW,
  });
  assert.equal(calls, 0);
  assert.equal(results[0].attempted, 0);
  assert.equal(results.length, 1, 'the country must still be reported');
});

test('flagValue reads a value, and reports an absent flag as null', () => {
  assert.equal(flagValue(['--country', 'CL'], '--country'), 'CL');
  // Absent is not an error -- the no-flag default is a legitimate full run.
  assert.equal(flagValue(['--dry-run'], '--country'), null);
});

test('flagValue refuses a flag with no value at all', () => {
  // `--limit` with no value gave Number(undefined) = NaN and slice(0, NaN) =
  // zero countries: a silent no-op that still looked like a successful run.
  assert.throws(() => flagValue(['--limit'], '--limit'), /--limit needs a value/);
});

test('flagValue refuses a flag whose value is the next flag', () => {
  // `--country` swallowing the following flag left onlyCountry falsy, which
  // skipped the filter and ran all 129 countries -- the operator's whole
  // credential spent on a typo.
  assert.throws(() => flagValue(['--country', '--limit', '3'], '--country'), /--country needs a value/);
});

test('each country is counted on its own', async () => {
  // Every other test here runs one country, so a counter shared across the
  // loop would go unnoticed -- and coverage.json is per-country.
  const paths = tmp();
  const wide = [
    ...springs,
    { id: 'whs_00000000000c', name: 'C', location: { country: 'BO' } },
  ];
  const wideById = new Map(wide.map((s) => [s.id, s]));
  fs.mkdirSync(paths.overlayDir, { recursive: true });
  fs.writeFileSync(path.join(paths.overlayDir, 'whs_00000000000c.json'), '{}');

  // CL's one candidate verifies; BO's only candidate is already on disk.
  const proposer = { complete: async ({ user }) => (
    JSON.parse(user).country === 'CL'
      ? { claims: { 'temperature.celsius': { value: 42.5 } } }
      : { claims: {} }
  ) };
  const verifier = { complete: async () => ({ refuted: false, reason: 'stated plainly' }) };

  const results = await runPlan({
    plan: [
      { country: 'CL', candidates: ['whs_00000000000a'] },
      { country: 'BO', candidates: ['whs_00000000000c'] },
    ],
    byId: wideById, knownIds: new Set(wideById.keys()), roles,
    providers: { proposer, verifier }, ...paths, ...wired, now: NOW,
  });

  assert.deepEqual(results, [
    { country: 'CL', candidates: 1, attempted: 1, verified: 1, alreadyHad: 0 },
    { country: 'BO', candidates: 1, attempted: 0, verified: 0, alreadyHad: 1 },
  ]);
});

test('the source excerpt is centred on the evidence, not taken from the head', () => {
  // Trimming the verifier's input is the main cost lever, but trimming it
  // naively is worse than not trimming: a head slice drops the sentence that
  // states the value, and the verifier then correctly refutes a true claim.
  // Cost saving traded for silent accuracy loss is the wrong trade here.
  const long = 'x'.repeat(50_000) + ' the water is 42.5 degrees ' + 'y'.repeat(50_000);
  const excerpt = sourceExcerpt(long, 42.5);
  assert.ok(excerpt.length <= SOURCE_EXCERPT_CHARS);
  assert.match(excerpt, /42\.5 degrees/, 'the evidence must survive the trim');
  assert.doesNotMatch(long.slice(0, SOURCE_EXCERPT_CHARS), /42\.5 degrees/,
    'a head slice would have lost it -- that is why this is centred');
});

test('the excerpt finds a comma-decimal, and leaves short pages whole', () => {
  const page = 'a'.repeat(20_000) + ' 42,5 C ' + 'b'.repeat(20_000);
  assert.match(sourceExcerpt(page, 42.5), /42,5/);
  assert.equal(sourceExcerpt('short page', 42.5), 'short page');
});

test('maxAttempts stops the run before spending past it', async () => {
  const paths = tmp();
  let calls = 0;
  const counting = { complete: async () => { calls++; return { claims: {} }; } };
  const wide = [
    { country: 'CL', candidates: ['whs_00000000000a', 'whs_00000000000b'] },
    { country: 'BO', candidates: ['whs_00000000000c'] },
  ];
  const ids = new Map(wide.flatMap((c) => c.candidates).map((id, i) => [
    id, { id, name: id, location: { country: i < 2 ? 'CL' : 'BO' } },
  ]));
  const results = await runPlan({
    plan: wide, byId: ids, knownIds: new Set(ids.keys()),
    roles: { proposer: 'a:1', verifier: 'b:1' },
    providers: { proposer: counting, verifier: counting },
    ...paths, ...wired, now: NOW, writeCoverage: true, maxAttempts: 1,
  });
  assert.equal(calls, 1, 'the cap must bind before the provider is called');
  assert.equal(results.length, 1, 'the second country is never started');
  // A capped run stopped part-way, so every country it never reached would
  // publish as unmet -- the artifact claiming sources do not exist when the
  // truth is the budget ran out.
  assert.equal(fs.existsSync(paths.coverageFile), false,
    'a partial run must not publish a coverage map');
});

// --- Retrieval: search, URL fallthrough, and the extraction prompt ---------

test('search results are tried in order, and the second is used when the first fails', async () => {
  // Four of eight real results were TripAdvisor, Viator, Facebook and
  // Marriott. TripAdvisor blocks crawlers, and a spring is not unenrichable
  // because an aggregator ranked first.
  const paths = tmp();
  const tried = [];
  const fetchImpl = async (url) => {
    tried.push(url);
    if (url.includes('tripadvisor')) return { ok: false, status: 403, text: async () => '' };
    return { ok: true, text: async () => PAGE };
  };
  const proposer = { complete: async () => ({
    claims: { 'temperature.celsius': { value: 42.5 } },
  }) };
  const verifier = { complete: async () => ({ refuted: false, reason: 'stated plainly' }) };

  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW, fetchImpl,
    searchImpl: found('https://tripadvisor.com/x', 'https://secretlagoon.is/'),
  });

  assert.deepEqual(tried, ['https://tripadvisor.com/x', 'https://secretlagoon.is/'],
    'the blocked result must be tried first, then the next one');
  const written = JSON.parse(
    fs.readFileSync(path.join(paths.overlayDir, 'whs_00000000000a.json'), 'utf8'),
  );
  assert.equal(written.claims['temperature.celsius'].source, 'https://secretlagoon.is/',
    'the citation must be the URL that actually served the text');
  // The blocked one is still logged: a silent skip loses the only evidence of
  // which domains this pipeline cannot read.
  assert.deepEqual(
    refutations(paths.refutationsFile).map((r) => [r.outcome, r.source]),
    [['source-not-found', 'https://tripadvisor.com/x']],
  );
});

test('a spring whose every result is unfetchable writes no file and logs each URL', async () => {
  const paths = tmp();
  const proposer = { complete: async () => { throw new Error('the proposer must never be reached'); } };
  const results = await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier: silent }, ...paths, now: NOW,
    searchImpl: found('https://a.example/1', 'https://b.example/2'),
    lookupImpl: publicLookup, fetchImpl: async () => ({ ok: false, status: 403, text: async () => '' }),
  });
  assert.equal(fs.existsSync(paths.overlayDir), false);
  assert.equal(results[0].verified, 0);
  assert.deepEqual(
    refutations(paths.refutationsFile).map((r) => r.source),
    ['https://a.example/1', 'https://b.example/2'],
    'one refutation per attempted URL, each naming the URL it was about',
  );
});

test('the per-spring URL cap bounds how much one spring can cost', async () => {
  // Without a cap, a spring whose whole result page is aggregators walks every
  // result -- and the fetch pool is shared with every other spring in the run.
  const paths = tmp();
  let fetches = 0;
  const urls = Array.from({ length: 12 }, (_, i) => `https://junk.example/${i}`);
  const out = await attempt(
    springs[0], roles, { proposer: silent, verifier: silent }, paths.refutationsFile, NOW,
    {
      searchImpl: found(...urls),
      lookupImpl: publicLookup, fetchImpl: async () => { fetches++; return { ok: false, status: 404, text: async () => '' }; },
    },
  );
  assert.equal(out, null);
  assert.equal(fetches, MAX_URLS_PER_SPRING, `at most ${MAX_URLS_PER_SPRING} URLs may be tried`);
  assert.ok(MAX_URLS_PER_SPRING < urls.length, 'the fixture must have more results than the cap');
  assert.equal(refutations(paths.refutationsFile).length, MAX_URLS_PER_SPRING);
});

test('a search with no results is recorded, and never reaches the proposer', async () => {
  const paths = tmp();
  const proposer = { complete: async () => { throw new Error('the proposer must never be reached'); } };
  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier: silent }, ...paths, now: NOW,
    searchImpl: async () => [], lookupImpl: publicLookup, fetchImpl: async () => { throw new Error('nothing to fetch'); },
  });
  // Distinct from no-claim-proposed: retrieval finding nothing and a page
  // stating nothing are different facts, and only one of them is the model's.
  assert.deepEqual(
    refutations(paths.refutationsFile).map((r) => r.outcome), ['no-source-found'],
  );
});

test('a broken search ends the run instead of marking springs hopeless', async () => {
  // Same rule as the rate limit: a missing CLI or an expired credential is a
  // fact about this machine. Logged as a refutation it would mark every spring
  // the run touched as already-attempted, and the resume-skip would never try
  // them again.
  const paths = tmp();
  await assert.rejects(
    () => runPlan({
      plan, byId, knownIds, roles,
      providers: { proposer: silent, verifier: silent }, ...paths, now: NOW,
      searchImpl: async () => { throw new Error('TinyFish search could not run (ENOENT)'); },
      lookupImpl: publicLookup, fetchImpl: serving(),
    }),
    /TinyFish search could not run/,
  );
  assert.equal(fs.existsSync(paths.refutationsFile), false,
    'a broken search must leave no per-spring record at all');
  assert.equal(fs.existsSync(paths.overlayDir), false);
});

test('an exhausted rate limit ends the run and writes nothing', async () => {
  // A throttled account is not evidence about a spring. If this were caught
  // into a refutation, every spring touched during the throttled window would
  // be skipped forever by the resume logic.
  const paths = tmp();
  const proposer = { complete: async () => { throw new RateLimitedError('spacexai/x', 'rate-limited'); } };
  await assert.rejects(
    () => runPlan({
      plan, byId, knownIds, roles,
      providers: { proposer, verifier: silent }, ...paths, ...wired, now: NOW,
    }),
    (err) => {
      assert.ok(err instanceof RateLimitedError);
      return true;
    },
  );
  assert.equal(fs.existsSync(paths.refutationsFile), false,
    'a rate limit must not be recorded as a fact about a spring');
  assert.equal(fs.existsSync(paths.overlayDir), false);
});

test('the proposer is given the retrieved text and the URL it came from', async () => {
  // The old prompt sent a spring name and asked the model to recall a
  // citation; it declined every time, correctly. This asserts the flow really
  // inverted rather than the prompt merely being reworded.
  const paths = tmp();
  let seen;
  const proposer = { complete: async (input) => { seen = input; return { claims: {} }; } };
  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier: silent }, ...paths, now: NOW,
    searchImpl: oneResult,
    lookupImpl: publicLookup, fetchImpl: serving('<html><body>Njarsvik pool stays at 38-40 Celsius all year.</body></html>'),
  });
  const payload = JSON.parse(seen.user);
  assert.equal(payload.url, 'https://example.org/a');
  assert.match(payload.page, /stays at 38-40 Celsius/, 'the fetched text must reach the proposer');
  assert.equal(payload.spring, 'A');
  // The schema must not invite a citation: the URL is ours, and a model-chosen
  // one could name a page whose text was never checked.
  assert.equal(seen.schema.properties.claims.additionalProperties.properties.source, undefined);
  assert.deepEqual(seen.schema.properties.claims.additionalProperties.required, ['value']);
});

test('the proposer prompt forbids computing a value the page never states', async () => {
  // Not stylistic. See the test below: the deterministic check cannot catch a
  // midpoint, so this instruction is the only thing standing between a
  // published 39 and a page that says 38-40.
  assert.match(PROPOSER_SYSTEM, /literally/i);
  assert.match(PROPOSER_SYSTEM, /never 39/);
  assert.match(PROPOSER_SYSTEM, /Never compute, convert, average, round, or infer/);
});

test('the fetch-check alone cannot catch a midpoint, which is why the prompt must', async () => {
  // Measured against a real page: the only 39 on it was inside
  // `WhatsApp +354 777 39 35`, and valueAppears said yes.
  const page = 'The lagoon stays at 38-40 Celsius. WhatsApp +354 777 39 35 Join Our Team';
  assert.equal(valueAppears(39, page), true,
    'if this ever becomes false the deterministic check has grown teeth -- keep the prompt anyway');
  assert.equal(valueAppears(38, page), true);
  assert.equal(valueAppears(40, page), true);
});

test('the verifier reads page text, never a URL it could go fetch itself', async () => {
  // The verifier's independence is the point of the two-provider design. Hand
  // it a URL and it stops checking the text we retrieved.
  const paths = tmp();
  let seen;
  const proposer = { complete: async () => ({ claims: { 'temperature.celsius': { value: 42.5 } } }) };
  const verifier = { complete: async (input) => { seen = input; return { refuted: true, reason: 'no' }; } };
  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, ...wired, now: NOW,
  });
  const payload = JSON.parse(seen.user);
  assert.deepEqual(Object.keys(payload).sort(), ['field', 'source', 'spring', 'value']);
  assert.doesNotMatch(payload.source, /^https?:/, 'the verifier gets text, not a link');
  assert.equal(seen.tools, undefined, 'no tool is ever handed to the verifier');
});

test('the search query names the spring and its country', () => {
  assert.equal(
    searchQuery({ name: 'Gamla Laugin', location: { country: 'IS' } }),
    'Gamla Laugin IS hot spring water temperature',
  );
});


// --- Step 1: a numeric field's value must arrive as a number --------------

test('a numeric field proposed as a string is refused, never coerced', async () => {
  // The real run returned "40" and "3300". Number("40") would have published
  // the right answer here and the wrong one for "about 40" and "", inventing
  // precision the page never stated -- so this must refuse, not repair.
  const paths = tmp();
  const proposer = { complete: async () => ({
    claims: { 'temperature.celsius': { value: '42.5' } },
  }) };
  const verifier = { complete: async () => { throw new Error('the verifier must never be reached'); } };

  const results = await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, ...wired, now: NOW,
  });

  assert.equal(fs.existsSync(paths.overlayDir), false, 'no overlay directory should be created');
  assert.equal(results[0].verified, 0);
  const log = refutations(paths.refutationsFile);
  assert.deepEqual(log.map((r) => r.outcome), ['value-not-numeric']);
  // Logged as what arrived. A record showing 42.5 would say the proposer did
  // the right thing and something else went wrong.
  assert.equal(log[0].proposed, '42.5');
  assert.equal(typeof log[0].proposed, 'string');
  assert.equal(log[0].field, 'temperature.celsius');
});

test('every non-numeric shape of a numeric value is refused', async () => {
  // A numeric-looking string, an empty one, a bare object and null all reach
  // `value` through the same untyped JSON. None may become a claim, and none
  // may crash a run.
  for (const value of ['40', '', 'about 40', null, true, [40], { c: 40 }]) {
    const paths = tmp();
    const proposer = { complete: async () => ({ claims: { 'location.elevation': { value } } }) };
    const verifier = { complete: async () => { throw new Error('the verifier must never be reached'); } };
    await runPlan({
      plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
      byId, knownIds, roles,
      providers: { proposer, verifier }, ...paths, ...wired, now: NOW,
    });
    assert.equal(fs.existsSync(paths.overlayDir), false, `${JSON.stringify(value)} must produce no file`);
    assert.deepEqual(
      refutations(paths.refutationsFile).map((r) => r.outcome),
      ['value-not-numeric'],
      `${JSON.stringify(value)} must be refused as non-numeric`,
    );
  }
});

test('a string-valued literal field is untouched by the numeric rule', async () => {
  // access.currency is a LITERAL_FIELD and is not a number. Refusing it would
  // turn the numeric rule into a rule against literal fields.
  const paths = tmp();
  const proposer = { complete: async () => ({ claims: { 'access.currency': { value: 'ISK' } } }) };
  const verifier = { complete: async () => ({ refuted: false, reason: 'the page prices in ISK' }) };
  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW,
    searchImpl: oneResult, lookupImpl: publicLookup, fetchImpl: serving('<html><body>Entry to A costs 3300 ISK.</body></html>'),
  });
  const written = JSON.parse(fs.readFileSync(path.join(paths.overlayDir, 'whs_00000000000a.json'), 'utf8'));
  assert.equal(written.claims['access.currency'].value, 'ISK');
  assert.deepEqual(refutations(paths.refutationsFile), []);
});

test('the numeric fields are the literal fields that hold numbers', () => {
  assert.deepEqual(NUMERIC_FIELDS, [
    'temperature.celsius', 'location.elevation',
    'minerals.ph', 'minerals.tds', 'minerals.sulfate', 'minerals.bicarbonate', 'minerals.chloride',
    'minerals.calcium', 'minerals.magnesium', 'minerals.sodium', 'minerals.silica', 'minerals.iron',
  ]);
  for (const f of NUMERIC_FIELDS) {
    assert.ok(LITERAL_FIELDS.includes(f), `${f} must also be fetch-checkable`);
  }
  // Not every literal field is a number. access.price is stated verbatim on a
  // page and is a string; treating "literal" as "numeric" is what made this
  // pipeline refuse the prices five human contributors got right.
  assert.ok(LITERAL_FIELDS.includes('access.price'));
  assert.ok(!NUMERIC_FIELDS.includes('access.price'));
});

test('the numeric fields are exactly the number-typed fields overlay.mjs declares', () => {
  // Derived, not copied. The two lists diverged once because enrich.mjs kept
  // its own idea of which fields hold numbers.
  assert.deepEqual(
    NUMERIC_FIELDS,
    Object.keys(FIELD_TYPES).filter((f) => FIELD_TYPES[f] === 'number'),
  );
});

test('a price string reaches the overlay and validates there', async () => {
  // The divergence, end to end: a human contributor may write this price and
  // gate-1 accepts it, so the agent path must accept it too rather than
  // logging value-not-numeric for a value that is correct.
  const paths = tmp();
  const price = 'Adults $42-$60 (peak/off-peak vary)';
  const proposer = { complete: async () => ({ claims: { 'access.price': { value: price } } }) };
  const verifier = { complete: async () => ({ refuted: false, reason: 'the page lists both prices' }) };
  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW,
    searchImpl: oneResult,
    lookupImpl: publicLookup, fetchImpl: serving(`<html><body>Admission: Adults $42-$60 (peak/off-peak vary).</body></html>`),
  });
  const written = JSON.parse(
    fs.readFileSync(path.join(paths.overlayDir, 'whs_00000000000a.json'), 'utf8'),
  );
  assert.equal(written.claims['access.price'].value, price);
  assert.deepEqual(refutations(paths.refutationsFile), []);
  // gate-1 runs this exact function on the file a contributor submits.
  assert.deepEqual(validateOverlay(written, { knownIds }), []);
});

test('the proposal schema demands a number for each numeric field', async () => {
  // The refusal above is the enforcement; this is the request that should stop
  // most models producing the string in the first place. Both are needed: a
  // schema in a prompt is asked for, not guaranteed.
  const paths = tmp();
  let schema;
  const proposer = { complete: async (input) => { schema = input.schema; return { claims: {} }; } };
  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier: silent }, ...paths, ...wired, now: NOW,
  });
  for (const field of NUMERIC_FIELDS) {
    assert.equal(
      schema?.properties?.claims?.properties?.[field]?.properties?.value?.type,
      'number',
      `${field} must be typed as a number in the proposal schema`,
    );
  }
  // And a prose field must still accept what it actually holds, or the schema
  // has silently narrowed the whole claim set to numbers.
  assert.equal(schema.properties.claims.properties['access.notes'], undefined);
  assert.equal(schema.properties.claims.additionalProperties.properties.value.type, undefined);
});

// --- Step 2: a range endpoint is claimable, and the verifier is told so ----

test('a temperature published as a range reaches the overlay through its endpoint', async () => {
  // The failure that produced no claim at all: the page publishes 38-40, the
  // proposer correctly claims 40, and the pipeline must carry it end to end.
  const paths = tmp();
  const page = '<html><body>The water at A stays at 38-40 Celsius all year round.</body></html>';
  const proposer = { complete: async () => ({ claims: { 'temperature.celsius': { value: 40 } } }) };
  const verifier = { complete: async () => ({ refuted: false, reason: 'the page states 38-40' }) };
  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW,
    searchImpl: oneResult, lookupImpl: publicLookup, fetchImpl: serving(page),
  });
  const file = path.join(paths.overlayDir, 'whs_00000000000a.json');
  assert.ok(fs.existsSync(file), 'a range endpoint must be publishable');
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(written.claims['temperature.celsius'].value, 40);
  assert.deepEqual(validateOverlay(written, { knownIds }), []);
});

test('the verifier is told a range endpoint is stated, not uncertain', () => {
  // The two prompts contradicted each other: the proposer was told to claim an
  // endpoint and the verifier to refute when uncertain, which is how a correct
  // 40 was refuted for "not 40 specifically, but within that range".
  assert.match(VERIFIER_SYSTEM, /endpoint of a range/i);
  assert.match(VERIFIER_SYSTEM, /38\D{0,3}40/, 'both prompts must carry the same worked example');
  assert.match(PROPOSER_SYSTEM, /38\D{0,3}40/);
  // The general default must survive. Weakening it everywhere would be a
  // different and much worse fix than naming the one case.
  assert.match(VERIFIER_SYSTEM, /uncertain/i);
});

test('the verifier is actually sent the prompt that permits the endpoint', async () => {
  // An exported constant nobody passes is a comment. This is the only
  // assertion connecting the wording above to a running verifier.
  const paths = tmp();
  let seen;
  const proposer = { complete: async () => ({ claims: { 'temperature.celsius': { value: 42.5 } } }) };
  const verifier = { complete: async (input) => { seen = input; return { refuted: true, reason: 'no' }; } };
  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, ...wired, now: NOW,
  });
  assert.equal(seen.system, VERIFIER_SYSTEM);
});

// --- Step 3: a verdict that is not a boolean is not a refusal --------------

test('a verdict with no boolean is recorded as unanswered, not as a refusal', async () => {
  // The real run logged refuted-by-verifier under a reason arguing the claim
  // was correct. That line is a false fact in a permanent public log.
  const paths = tmp();
  const proposer = { complete: async () => ({ claims: { 'temperature.celsius': { value: 42.5 } } }) };
  const verifier = { complete: async () => ({ reason: 'Therefore, it states this value about this spring.' }) };

  const results = await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, ...wired, now: NOW,
  });

  assert.equal(fs.existsSync(paths.overlayDir), false, 'fail-closed: still no file');
  assert.equal(results[0].verified, 0);
  const log = refutations(paths.refutationsFile);
  assert.deepEqual(log.map((r) => r.outcome), ['verifier-verdict-malformed']);
  assert.equal(log[0].verifier, 'b:1', 'the provider that failed to answer must be named');
});

test('every non-boolean verdict fails closed under the unanswered outcome', async () => {
  // "false" as a string is the dangerous one: a check for a falsy `refuted`
  // would publish it, and `!== false` would call it a refusal.
  for (const verdict of [{ refuted: 'false' }, { refuted: 'true' }, { refuted: 0 }, { refuted: null }, null, 'refuted']) {
    const paths = tmp();
    const proposer = { complete: async () => ({ claims: { 'temperature.celsius': { value: 42.5 } } }) };
    const verifier = { complete: async () => verdict };
    await runPlan({
      plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
      byId, knownIds, roles,
      providers: { proposer, verifier }, ...paths, ...wired, now: NOW,
    });
    assert.equal(fs.existsSync(paths.overlayDir), false, `${JSON.stringify(verdict)} must publish nothing`);
    assert.deepEqual(
      refutations(paths.refutationsFile).map((r) => r.outcome),
      ['verifier-verdict-malformed'],
      `${JSON.stringify(verdict)} is not an answer`,
    );
  }
});

test('an explicit refusal is still a refutation, distinct from an unanswered one', async () => {
  const paths = tmp();
  const proposer = { complete: async () => ({ claims: { 'temperature.celsius': { value: 42.5 } } }) };
  const verifier = { complete: async () => ({ refuted: true, reason: 'this is a different pool' }) };
  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, ...wired, now: NOW,
  });
  const log = refutations(paths.refutationsFile);
  assert.deepEqual(log.map((r) => r.outcome), ['refuted-by-verifier']);
  assert.equal(log[0].note, 'this is a different pool');
});
