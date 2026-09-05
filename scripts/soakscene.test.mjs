/**
 * Source guards for the soak scene and the globe drift.
 *
 * There is no React test harness here -- `npm test` runs only
 * scripts/**\/*.test.mjs -- so these are source-text guards in the style of
 * mapview.test.mjs and detailpanel.test.mjs. They cannot prove the canvas
 * paints; they pin two defects that were found by review and would otherwise
 * come back silently, because neither produces an error.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SCENE = fs.readFileSync('src/components/SoakScene.tsx', 'utf8');
const MAPVIEW = fs.readFileSync('src/components/MapView.tsx', 'utf8');

test('the scene canvas is resized on height changes, not only width', () => {
  // The original guard compared width alone, so a container that changed
  // height at constant width kept the old backing-store height and painted a
  // vertically stretched scene. Nothing throws when this regresses -- the
  // picture is just wrong -- so it needs pinning here.
  assert.ok(
    SCENE.includes('canvas.width !== cw || canvas.height !== ch'),
    'compare both dimensions before resizing the backing store',
  );
});

test('the scene canvas is never resized on width alone', () => {
  // The positive check above passes if someone adds a second, width-only
  // branch alongside it. This is the assertion that actually forbids the bug.
  assert.ok(
    !/canvas\.width !== Math\.round\([^)]*\)\s*\)\s*\{/.test(SCENE),
    'a width-only resize condition is the defect this file exists to prevent',
  );
});

test('keyboard interaction stops the idle globe drift', () => {
  // mousedown/touchstart/wheel miss MapLibre's keyboard navigation entirely,
  // so a keyboard user below zoom 4 had the globe start turning under them.
  assert.ok(
    MAPVIEW.includes("container.addEventListener('keydown', noteInteract)"),
    'keyboard panning must count as interaction',
  );
  assert.ok(
    MAPVIEW.includes("container.removeEventListener('keydown', noteInteract)"),
    'and must be removed on unmount, or it outlives the map',
  );
});

test('the movestart listener only reacts to human-driven moves', () => {
  // MapView does listen for 'movestart', and must: a user grabbing the camera
  // has to win over a scripted flight. But the drift moves the camera itself,
  // and the descent flies it. An unguarded handler would treat both as
  // interaction -- cancelling every flight it started and stopping the spin on
  // its own first frame. `e.originalEvent` is present only for real input, and
  // it is the whole reason that listener is safe to have.
  const idx = MAPVIEW.indexOf("m.on('movestart'");
  assert.ok(idx > 0, "the movestart listener should still exist");
  const handler = MAPVIEW.slice(idx, idx + 200);
  assert.ok(
    handler.includes('e.originalEvent'),
    'guard movestart on e.originalEvent, or programmatic camera moves count as interaction',
  );
});

test('the retry timer is cleared before it is reassigned', () => {
  // Assigning over a pending timer leaks it; the orphan still fires.
  const idx = MAPVIEW.indexOf('prev.selectedId !== null && s.selectedId === null');
  assert.ok(idx > 0, 'the deselect branch should still exist');
  const branch = MAPVIEW.slice(idx, idx + 400);
  const clearAt = branch.indexOf('window.clearTimeout(retryTimer)');
  const setAt = branch.indexOf('retryTimer = window.setTimeout');
  // Assert presence before ordering. Comparing the indices alone passes when
  // the clear is deleted outright -- indexOf returns -1, and -1 is less than
  // any real index. That is the exact regression this test exists to catch,
  // and the first draft of it was green with the clear removed.
  assert.notEqual(clearAt, -1, 'the deselect branch must clear the pending timer');
  assert.notEqual(setAt, -1, 'the deselect branch should still arm a retry');
  assert.ok(clearAt < setAt, 'clear the pending timer before assigning a new one');
});
