import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isExcluded } from './lib/exclusions.mjs';
import { distanceMeters } from './lib/geo.mjs';

const SOURCE = fs.readFileSync('scripts/build-dataset.mjs', 'utf8');

test('the privacy filter is the last stage that can remove or move a record', () => {
  const privacyAt = SOURCE.indexOf('isExcluded(');
  const dedupeAt = SOURCE.indexOf('dedupe(records)');
  assert.ok(privacyAt > 0 && dedupeAt > 0, 'both stages must exist');
  assert.ok(
    dedupeAt < privacyAt,
    'dedupe must run BEFORE the privacy filter. mergeInto() adopts the winner ' +
      'coordinates, so a merge after the check can move a record into an ' +
      'exclusion radius that has already been cleared.',
  );
});

test('a merged record is re-checked at its post-merge position', () => {
  // The concrete hazard the ordering exists to prevent. A record sits outside
  // an exclusion radius on its own, passes the filter, and is then pulled
  // inside it by a merge that adopts the winner's coordinates.
  const exclusions = { entries: [{ lat: 64.0, lng: -21.0, radiusMeters: 500 }] };
  const beforeMerge = { id: 'osm-node-1', name: 'X', location: { lat: 64.01, lng: -21.0 } };
  const afterMerge = { id: 'osm-node-1', name: 'X', location: { lat: 64.002, lng: -21.0 } };

  assert.ok(
    distanceMeters(beforeMerge.location, { lat: 64.0, lng: -21.0 }) > 500,
    'the pre-merge position must genuinely sit outside the radius',
  );
  assert.equal(isExcluded(beforeMerge, exclusions), false);
  assert.equal(
    isExcluded(afterMerge, exclusions),
    true,
    'the post-merge position is inside the radius, so stage order decides ' +
      'whether this spring is published',
  );
});

test('nothing that can add, move, or reintroduce a record runs after the privacy filter', () => {
  // Guards against a future stage being appended below the filter. The filter
  // is the project's central guarantee; anything after it is unchecked.
  const privacyAt = SOURCE.indexOf('isExcluded(');
  const tail = SOURCE.slice(privacyAt);
  for (const forbidden of ['dedupe(', 'mergeInto(', 'normalizeElement(']) {
    assert.ok(
      !tail.includes(forbidden),
      `${forbidden} appears after the privacy filter; it can change what is published`,
    );
  }
});

test('the unicorn invariant is asserted before anything is written', () => {
  const leakAt = SOURCE.indexOf("r.unicorn !== false");
  const writeAt = SOURCE.indexOf('fs.writeFileSync(OUT_JSON');
  assert.ok(leakAt > 0 && writeAt > 0);
  assert.ok(leakAt < writeAt, 'the unicorn check must gate the write, not follow it');
});
