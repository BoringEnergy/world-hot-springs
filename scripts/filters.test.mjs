/**
 * The filter predicate, tested against the dataset that ships.
 *
 * Layer B, like card-model.test.mjs: `applyFilters` is a pure function of
 * (springs, filters), so Node imports the TypeScript directly by stripping its
 * types. No React, no DOM, no second stack.
 *
 * This file exists because the predicate shipped a defect that no test could
 * have caught from a synthetic record: the rail renders the ceiling as
 * "212°F+" and the predicate read it as a hard lid, so the three springs above
 * 100C were absent from every view the UI can reach. A search for one by name
 * answered "0 springs" -- not an error, a denial. The atlas held the record
 * the whole time.
 *
 * So the assertions below run against data/hot-springs.json rather than
 * fixtures. A synthetic 110C spring would prove the branch; only the real file
 * proves the atlas is reachable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { applyFilters, DEFAULT_FILTERS, TEMP_CEIL, TEMP_FLOOR } from '../src/store/useStore.ts';

const ALL = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));

/**
 * Regression: ISSUE-001 -- the temperature ceiling hid every spring above 100C.
 * Found by /qa on 2026-09-11.
 * Report: .gstack/qa-reports/qa-report-localhost-2026-09-11.md
 */
test('the default filters reach every spring in the atlas', () => {
  // The strongest statement this file can make, and the one that failed: with
  // nothing narrowed, nothing is hidden. 7,487 of 7,490 was the bug.
  const visible = applyFilters(ALL, DEFAULT_FILTERS);
  assert.equal(visible.length, ALL.length);
});

test('the ceiling is open-ended, because the rail says "+"', () => {
  const boiling = ALL.filter((s) => s.temperature.celsius !== null && s.temperature.celsius > TEMP_CEIL);
  // Not vacuous: if the dataset ever stops holding water above 100C this
  // assertion says so rather than passing on an empty set.
  assert.ok(boiling.length > 0, 'the atlas should still hold springs above the ceiling');

  const visible = new Set(applyFilters(ALL, DEFAULT_FILTERS).map((s) => s.id));
  for (const s of boiling) {
    assert.ok(visible.has(s.id), `${s.name} (${s.temperature.celsius}C) is unreachable`);
  }
});

test('a spring above the ceiling is findable by name', () => {
  // The user-visible shape of the defect. Searching for a spring this atlas
  // holds and being told "0 springs" is worse than an error: it reads as an
  // answer.
  const boiling = ALL
    .filter((s) => s.temperature.celsius !== null && s.temperature.celsius > TEMP_CEIL)
    .filter((s) => s.name);
  assert.ok(boiling.length > 0);

  for (const s of boiling) {
    const hits = applyFilters(ALL, { ...DEFAULT_FILTERS, query: s.name });
    assert.ok(hits.some((h) => h.id === s.id), `searching "${s.name}" does not return it`);
  }
});

test('a ceiling the user actually moved is still a lid', () => {
  // The fix must not turn every upper bound into "and above". Only the rail's
  // own maximum means open-ended, because that is the only value it renders
  // with a "+".
  const narrowed = applyFilters(ALL, { ...DEFAULT_FILTERS, tempMax: 40, includeUnknownTemp: false });
  assert.ok(narrowed.length > 0);
  for (const s of narrowed) assert.ok(s.temperature.celsius <= 40, `${s.name} is above 40C`);
  // And the springs above 100C are correctly gone when a real lid is set.
  assert.equal(narrowed.filter((s) => s.temperature.celsius > TEMP_CEIL).length, 0);
});

test('the floor is a floor, and unknown temperatures are not zero', () => {
  // The neighbouring rule, which the fix had to leave alone: a spring with no
  // reading is not 0C, so narrowing the slider never silently drops the
  // records we simply lack a reading for.
  const noReading = ALL.filter((s) => s.temperature.celsius === null);
  assert.ok(noReading.length > 0);

  const included = applyFilters(ALL, { ...DEFAULT_FILTERS, tempMin: 40, includeUnknownTemp: true });
  assert.equal(
    included.filter((s) => s.temperature.celsius === null).length,
    noReading.length,
    'an unknown temperature must survive a raised floor',
  );

  const excluded = applyFilters(ALL, { ...DEFAULT_FILTERS, tempMin: TEMP_FLOOR, includeUnknownTemp: false });
  assert.equal(excluded.filter((s) => s.temperature.celsius === null).length, 0);
});
