import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPlan, flagValue, sourceExcerpt, SOURCE_EXCERPT_CHARS } from './enrich.mjs';
import { validateOverlay } from './lib/overlay.mjs';

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
    providers: { proposer: silent, verifier: silent }, ...paths, now: NOW,
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
    providers: { proposer: silent, verifier: silent }, ...paths, now: NOW,
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
    providers: { proposer: counting, verifier: counting }, ...paths, now: NOW,
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
    providers: { proposer: counting, verifier: counting }, ...paths, now: NOW,
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
    providers: { proposer: counting, verifier: counting }, ...paths, now: NOW,
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
    providers: { proposer: silent, verifier: silent }, ...paths, now: NOW,
    writeCoverage: false,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.coverageFile, 'utf8')), { sentinel: true });
});

test('end to end, a verified claim produces a file that validateOverlay accepts', async () => {
  const paths = tmp();
  const page = '<html><body>The water at A is 42.5 degrees.</body></html>';
  const proposer = { complete: async () => ({
    claims: { 'temperature.celsius': { value: 42.5, source: 'https://example.org/a' } },
  }) };
  const verifier = { complete: async () => ({ refuted: false, reason: 'stated plainly' }) };
  const fetched = [];
  const fetchImpl = async (url) => { fetched.push(url); return { ok: true, text: async () => page }; };

  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW, fetchImpl,
  });

  // Without this the pipeline could be reading nothing at all and the rest of
  // the assertions would still hold: they would be testing the stub proposer.
  assert.deepEqual(fetched, ['https://example.org/a'], 'the cited source must actually be fetched');

  const file = path.join(paths.overlayDir, 'whs_00000000000a.json');
  assert.ok(fs.existsSync(file), 'a verified claim must produce a file');
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(written.id, 'whs_00000000000a');
  assert.equal(written.claims['temperature.celsius'].value, 42.5);
  assert.equal(written.claims['temperature.celsius'].source, 'https://example.org/a');
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
  const page = '<html><body>The water at A is pleasant.</body></html>';
  const proposer = { complete: async () => ({
    claims: { 'temperature.celsius': { value: 42.5, source: 'https://example.org/a' } },
  }) };
  const verifier = { complete: async () => ({ refuted: false, reason: 'looks fine to me' }) };
  const fetchImpl = async () => ({ ok: true, text: async () => page });

  const results = await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW, fetchImpl,
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
  const proposer = { complete: async () => ({
    claims: { name: { value: 'Renamed', source: 'https://example.org/a' } },
  }) };
  const verifier = { complete: async () => { throw new Error('the verifier must never be reached'); } };
  const fetchImpl = async () => { throw new Error('a withheld field must never be fetched'); };

  const results = await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW, fetchImpl,
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
  const page = '<html><body>The water at A is 42.5 degrees.</body></html>';
  const proposer = { complete: async () => ({
    claims: { 'temperature.celsius': { value: 42.5, source: 'https://example.org/a' } },
  }) };
  // Not `refuted: true` but a malformed verdict: the code defaults to refuted
  // on anything that is not an explicit false, and that default is the point.
  const verifier = { complete: async () => ({ reason: 'no verdict field at all' }) };
  const fetchImpl = async () => ({ ok: true, text: async () => page });

  const results = await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW, fetchImpl,
  });

  assert.equal(fs.existsSync(paths.overlayDir), false);
  assert.equal(results[0].verified, 0);
  assert.deepEqual(
    refutations(paths.refutationsFile).map((r) => r.outcome),
    ['refuted-by-verifier'],
  );
});

test('an unretrievable source is recorded with the reason it failed', async () => {
  const paths = tmp();
  const proposer = { complete: async () => ({
    claims: { 'temperature.celsius': { value: 42.5, source: 'ftp://example.org/a' } },
  }) };
  const verifier = { complete: async () => { throw new Error('the verifier must never be reached'); } };
  const fetchImpl = async () => { throw new Error('a refused scheme must never be fetched'); };

  await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW, fetchImpl,
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
  const page = '<html><body>The water at A is 900 degrees.</body></html>';
  const proposer = { complete: async () => ({
    claims: { 'temperature.celsius': { value: 900, source: 'https://example.org/a' } },
  }) };
  const verifier = { complete: async () => ({ refuted: false, reason: 'stated plainly' }) };
  const fetchImpl = async () => ({ ok: true, text: async () => page });

  const results = await runPlan({
    plan: [{ country: 'CL', candidates: ['whs_00000000000a'] }],
    byId, knownIds, roles,
    providers: { proposer, verifier }, ...paths, now: NOW, fetchImpl,
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
  const page = '<html><body>The water is 42.5 degrees.</body></html>';
  const proposer = { complete: async () => {
    calls++;
    return { claims: { 'temperature.celsius': { value: 42.5, source: 'https://example.org/a' } } };
  } };
  const verifier = { complete: async () => ({ refuted: false, reason: 'stated plainly' }) };
  const fetchImpl = async () => ({ ok: true, text: async () => page });

  const results = await runPlan({
    plan: [{ country: 'CL', candidates: wide.map((s) => s.id) }],
    byId: wideById, knownIds: new Set(wideById.keys()), roles,
    providers: { proposer, verifier }, ...paths, now: NOW, fetchImpl,
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
    providers: { proposer: counting, verifier: counting }, ...paths, now: NOW,
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

  const page = '<html><body>The water is 42.5 degrees.</body></html>';
  // CL's one candidate verifies; BO's only candidate is already on disk.
  const proposer = { complete: async ({ user }) => (
    JSON.parse(user).country === 'CL'
      ? { claims: { 'temperature.celsius': { value: 42.5, source: 'https://example.org/a' } } }
      : { claims: {} }
  ) };
  const verifier = { complete: async () => ({ refuted: false, reason: 'stated plainly' }) };
  const fetchImpl = async () => ({ ok: true, text: async () => page });

  const results = await runPlan({
    plan: [
      { country: 'CL', candidates: ['whs_00000000000a'] },
      { country: 'BO', candidates: ['whs_00000000000c'] },
    ],
    byId: wideById, knownIds: new Set(wideById.keys()), roles,
    providers: { proposer, verifier }, ...paths, now: NOW, fetchImpl,
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
    ...paths, now: NOW, writeCoverage: true, maxAttempts: 1,
  });
  assert.equal(calls, 1, 'the cap must bind before the provider is called');
  assert.equal(results.length, 1, 'the second country is never started');
  // A capped run stopped part-way, so every country it never reached would
  // publish as unmet -- the artifact claiming sources do not exist when the
  // truth is the budget ran out.
  assert.equal(fs.existsSync(paths.coverageFile), false,
    'a partial run must not publish a coverage map');
});
