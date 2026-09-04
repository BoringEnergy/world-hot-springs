/**
 * Source guards for DetailPanel.
 *
 * There is no React test harness in this repository -- `npm test` runs only
 * scripts/**\/*.test.mjs -- so these are source-text guards in the same style
 * as mapview.test.mjs. They cannot prove the component renders; they can stop
 * two specific safety regressions coming back.
 *
 * Plain string searching rather than regex, deliberately: the assertion
 * messages can then name the exact source the file should contain, and the
 * checks stay readable to someone reviewing a safety claim.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SOURCE = fs.readFileSync('src/components/DetailPanel.tsx', 'utf8');

const PROHIBITION = 'spring.access.bathingAllowed === false && (';
const SCENE_GUARD = 'spring.access.bathingAllowed !== false && (';
const SCENE = '<SoakScene';

test('the soak scene is not rendered where bathing is prohibited', () => {
  // The scene depicts inviting water. On the 1,289 Yellowstone features the
  // land-manager layer marks bathingAllowed: false, that water is near
  // boiling and has killed people -- an illustrated soak there argues against
  // the atlas's own warning.
  assert.ok(
    SOURCE.includes(SCENE_GUARD),
    `DetailPanel should gate the scene on: ${SCENE_GUARD}`,
  );
  const guard = SOURCE.indexOf(SCENE_GUARD);
  const scene = SOURCE.indexOf(SCENE);
  assert.ok(scene > guard, 'the <SoakScene> element must sit inside that guard, not before it');
});

test('the scene is rendered once, so the guard cannot be bypassed', () => {
  // A second unguarded <SoakScene> would satisfy the ordering check above
  // while still painting a soak on a prohibited spring.
  const count = SOURCE.split(SCENE).length - 1;
  assert.equal(count, 1, 'exactly one <SoakScene> render site keeps the guard total');
});

test('the prohibition notice comes before the soak scene', () => {
  // Reading order is the point: the warning must not appear below the
  // illustration on any spring that carries both.
  assert.ok(SOURCE.includes(PROHIBITION), `DetailPanel should contain: ${PROHIBITION}`);
  assert.ok(
    SOURCE.indexOf(PROHIBITION) < SOURCE.indexOf(SCENE),
    'the "Do not enter the water" block must precede the scene',
  );
});

test('the prohibition and the scene guard read the same field', () => {
  // If these ever drift apart -- one on access.status, the other on
  // bathingAllowed -- there is a spring that shows a soak and a prohibition
  // at the same time, or neither.
  assert.ok(
    PROHIBITION.replace(' === false && (', '') === SCENE_GUARD.replace(' !== false && (', ''),
    'both must key off spring.access.bathingAllowed',
  );
});
