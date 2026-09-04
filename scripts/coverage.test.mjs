import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverage, MEASURES } from './lib/coverage.mjs';
import { TARGET_PER_COUNTRY } from './lib/flagship.mjs';

const results = [
  { country: 'CL', candidates: 5, attempted: 3, verified: 2 },
  { country: 'BO', candidates: 5, attempted: 5, verified: 0 },
];

test('unmet is the shortfall against the target, floored at zero', () => {
  const cov = buildCoverage(results, '2026-08-29T12:00:00.000Z');
  assert.equal(cov.countries.find((c) => c.country === 'CL').unmet, 0);
  assert.equal(cov.countries.find((c) => c.country === 'BO').unmet, 2);
});

test('a country exceeding its target never reports negative unmet', () => {
  const cov = buildCoverage([{ country: 'JP', candidates: 5, attempted: 5, verified: 4 }], 'x');
  assert.equal(cov.countries[0].unmet, 0);
});

test('a one-spring country that verified its only spring is not unmet', () => {
  // 21 countries have exactly one spring. Reporting unmet: 1 for a perfect
  // run would make the published artifact say the opposite of what happened.
  const cov = buildCoverage([{ country: 'VU', candidates: 1, attempted: 1, verified: 1 }], 'x');
  assert.equal(cov.countries[0].unmet, 0);
});

test('a one-spring country that verified nothing is unmet by one, not two', () => {
  const cov = buildCoverage([{ country: 'VU', candidates: 1, attempted: 1, verified: 0 }], 'x');
  assert.equal(cov.countries[0].unmet, 1);
});

test('the artifact carries its own framing', () => {
  // A reader who finds this file with no context must not conclude that
  // Bolivia has no hot springs.
  const cov = buildCoverage(results, 'x');
  assert.equal(cov.measures, MEASURES);
  assert.match(cov.measures, /not the number of hot springs/);
});

test('countries are sorted so the artifact is diffable', () => {
  const cov = buildCoverage(results, 'x');
  assert.deepEqual(cov.countries.map((c) => c.country), ['BO', 'CL']);
});

test('the three counts a reader needs travel through unchanged', () => {
  // unmet is derived; candidates/attempted/verified are the evidence for it.
  // Without these, a stub that only computed unmet would satisfy the suite.
  const cov = buildCoverage(results, 'x');
  assert.deepEqual(cov.countries.find((c) => c.country === 'CL'), {
    country: 'CL',
    candidates: 5,
    attempted: 3,
    verified: 2,
    // Present on every row, so a reader can always tell how much of a
    // country's coverage this run actually produced.
    alreadyHad: 0,
    unmet: 0,
  });
});

test('a target met entirely by pre-existing overlays reports no fresh verification', () => {
  // The case the split exists for. Folding these into `verified` would let a
  // resumed run that made no provider call at all publish a map claiming it
  // verified two springs -- under a `measures` string promising the number is
  // what THIS run could verify.
  const cov = buildCoverage([{ country: 'IS', candidates: 5, attempted: 0, verified: 0, alreadyHad: 2 }], 'x');
  assert.deepEqual(cov.countries[0], {
    country: 'IS',
    candidates: 5,
    attempted: 0,
    verified: 0,
    alreadyHad: 2,
    unmet: 0,
  });
});

test('unmet counts what the atlas holds, not what this run added', () => {
  // A resumption that verified one more on top of one already held has met
  // the target. Computing unmet from `verified` alone would report the
  // country short forever, however many runs it takes.
  const cov = buildCoverage([{ country: 'PE', candidates: 5, attempted: 4, verified: 1, alreadyHad: 1 }], 'x');
  assert.equal(cov.countries[0].unmet, 0);
});

test('the artifact records when it was generated and what it aimed for', () => {
  const cov = buildCoverage(results, '2026-08-29T12:00:00.000Z');
  assert.equal(cov.generatedAt, '2026-08-29T12:00:00.000Z');
  assert.equal(cov.target, TARGET_PER_COUNTRY);
});

test('buildCoverage does not mutate the caller\'s results', () => {
  const input = [{ country: 'CL', candidates: 5, attempted: 3, verified: 2 }, { country: 'BO', candidates: 5, attempted: 5, verified: 0 }];
  buildCoverage(input, 'x');
  assert.deepEqual(input.map((r) => r.country), ['CL', 'BO']);
});
