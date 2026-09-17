/**
 * check-bundle.mjs: the instrumentation markers are derived from MapView, and
 * the scan finds them where they are and nowhere else.
 *
 * The bundles themselves are not built here -- `npm test` stays a few seconds
 * long -- so the scanner runs over small planted directories. CI runs the real
 * thing against `dist/` and `dist-e2e/` (.github/workflows/ui.yml).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBundle, findMarkers, MAPVIEW, scanBundle } from './check-bundle.mjs';

const SOURCE = fs.readFileSync(MAPVIEW, 'utf8');

const made = [];
test.after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

function planted(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whs-bundle-'));
  made.push(dir);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

test('the markers are derived from MapView, and cover every hook it writes', () => {
  const markers = findMarkers(SOURCE);
  // Counted by splitting rather than by the regex under test, so a regex that
  // skipped a key would disagree with this rather than with itself.
  const keys = new Set(
    SOURCE.split('dataset.')
      .slice(1)
      .map((rest) => rest.match(/^[A-Za-z]+/)?.[0])
      .filter((k) => k?.startsWith('map')),
  );
  assert.ok(keys.size > 0, 'MapView writes no dataset.map* key; this test has nothing to check');
  for (const k of keys) assert.ok(markers.includes(k), `${k} is written by MapView but not checked`);
  assert.ok(markers.includes('__map'), 'window.__map is written by MapView but not checked');
});

test('the removed source-features attribute stays removed', () => {
  // Specs read the springs source through __map instead: an attribute that
  // restates the source's length is a second copy of the fact.
  assert.ok(!findMarkers(SOURCE).includes('mapSourceFeatures'), 'data-map-source-features is back in MapView');
});

test('a planted marker is found, and only as a whole identifier', () => {
  const dir = planted({
    'assets/a.js': 'document.documentElement.dataset.mapPhase="x";',
    'assets/b.js': 'const mapReadyAt=Date.now();window.__mapx=1;',
    'index.html': '<div></div>',
  });
  const hits = scanBundle(dir, ['mapPhase', 'mapReady', '__map']);
  assert.deepEqual(hits.get('mapPhase'), [path.join(dir, 'assets', 'a.js')]);
  assert.deepEqual(hits.get('mapReady'), [], 'mapReadyAt is not the mapReady hook');
  assert.deepEqual(hits.get('__map'), [], '__mapx is not the __map hook');
});

test('a clean bundle passes the default check and fails --expect-present', () => {
  const dir = planted({ 'assets/app.js': 'console.log("no hooks here")' });
  assert.deepEqual(checkBundle(dir), []);
  const problems = checkBundle(dir, { expectPresent: true });
  assert.equal(problems.length, findMarkers(SOURCE).length);
  assert.match(problems[0], /absent/);
});

test('an instrumented bundle fails the default check and passes --expect-present', () => {
  const body = findMarkers(SOURCE)
    .map((k) => (k === '__map' ? 'window.__map=m;' : `e.dataset.${k}="1";`))
    .join('');
  const dir = planted({ 'assets/app.js': body });
  const problems = checkBundle(dir);
  assert.equal(problems.length, findMarkers(SOURCE).length);
  assert.match(problems[0], /present in/);
  assert.deepEqual(checkBundle(dir, { expectPresent: true }), []);
});

test('a missing or empty directory is an error, not a pass', () => {
  // Checking `dist` before building it would otherwise certify a bundle that
  // does not exist.
  assert.throws(() => checkBundle(path.join(os.tmpdir(), 'whs-no-such-dist')), /does not exist/);
  assert.throws(() => checkBundle(planted({ 'notes.txt': '' })), /nothing to check/);
});

test('a source with no markers is reported, never passed', () => {
  const dir = planted({ 'assets/app.js': '' });
  const problems = checkBundle(dir, { source: 'export const nothing = 1;' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /derivation is broken/);
});
