/**
 * What the summary's date field means, pinned.
 *
 * It was called `generated`, and the About panel rendered it as "Dataset
 * built <date>". Neither was true: buildTimestamp() derives the value from
 * the newest raw-tile mtime (or SOURCE_DATE_EPOCH), so it is the date of the
 * OpenStreetMap snapshot, not the moment the build ran. The two diverge as
 * soon as you rebuild without refetching -- the normal case, since curated
 * claims land far more often than OSM is refreshed. Ours had drifted ten days
 * before anyone noticed, and the only symptom was a date that looked stale.
 *
 * That is a quiet failure on a project whose premise is not asserting what it
 * cannot support, so the name and the copy are now checked rather than
 * trusted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SUMMARY = JSON.parse(fs.readFileSync('data/summary.json', 'utf8'));
const GEOJSON_META = JSON.parse(fs.readFileSync('data/hot-springs.geojson', 'utf8')).metadata;
const ABOUT = fs.readFileSync('src/components/AboutPanel.tsx', 'utf8');
const BUILD = fs.readFileSync('scripts/build-dataset.mjs', 'utf8');

test('the summary dates the source, not the build', () => {
  assert.ok(SUMMARY.sourceDate, 'summary.json should carry sourceDate');
  assert.equal(SUMMARY.generated, undefined, '`generated` claimed this was the build time');
});

test('the geojson metadata uses the same name for the same thing', () => {
  // Two names for one value is how the misleading one survives a rename.
  assert.ok(GEOJSON_META.sourceDate, 'geojson metadata should carry sourceDate');
  assert.equal(GEOJSON_META.generated, undefined);
  assert.equal(GEOJSON_META.sourceDate, SUMMARY.sourceDate, 'both come from one build timestamp');
});

test('the About panel does not describe the date as a build date', () => {
  // The field rename is worthless if the sentence still says "built".
  assert.ok(
    !/Dataset[^.]*\bbuilt\b/.test(ABOUT),
    'the footer must not present the source date as when the dataset was built',
  );
  assert.ok(ABOUT.includes('summary.sourceDate'), 'the footer should render sourceDate');
});

test('the build never stamps wall-clock time into the artifacts', () => {
  // The whole reason the date lags: a `new Date()` here would make every
  // rebuild a 6MB diff and break the reproducibility gate. This is the
  // invariant the naming confusion was hiding.
  assert.ok(
    !/generatedAt\s*=\s*new Date\(\)/.test(BUILD),
    'the build timestamp must come from buildTimestamp(), not the clock',
  );
  assert.ok(
    BUILD.includes('buildTimestamp(RAW_DIR)'),
    'buildTimestamp derives the date from the inputs',
  );
});

test('coverage counts are taken after curated claims are applied', () => {
  // Withholding the overlay directory drops temperature 91 -> 87, so these
  // counters do reflect claims. If coverage were computed before
  // applyOverlays, every curated claim would be invisible in the README and
  // the About panel while the dataset itself was correct.
  const order = ['applyOverlays(', 'applyLandManagers(', 'let withTemp = 0'];
  let last = -1;
  for (const marker of order) {
    const at = BUILD.indexOf(marker);
    assert.notEqual(at, -1, `${marker} should still exist in the build`);
    assert.ok(at > last, `${marker} must come after the previous step`);
    last = at;
  }
});
