/**
 * Source guards for MapView.
 *
 * There is no React test harness in this repository -- `npm test` runs only
 * scripts/**\/*.test.mjs -- so these are source-text guards in the same style
 * as build.test.mjs and workflows.test.mjs. They cannot prove the component
 * renders; they can stop one specific defect coming back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SOURCE = fs.readFileSync('src/components/MapView.tsx', 'utf8');

test('no camera option is ever passed as an explicit undefined', () => {
  // `padding: <cond> ? {...} : undefined` blanked the entire app on every
  // narrow-viewport selection: MapLibre reads `.top` off the value when the
  // key is present, so an explicit undefined throws where omitting the key
  // is fine. React unmounted the tree and the page went white.
  //
  // Reproduced on the parent commit before the fix, so it was pre-existing
  // and simply unnoticed -- nothing here tests the React app.
  assert.doesNotMatch(
    SOURCE,
    /^\s*\w+:\s*.*\?\s*.*:\s*undefined\s*,/m,
    'pass the key conditionally with a spread instead of setting it to undefined',
  );
});

test('padding is applied by spreading, so the key is absent when unused', () => {
  assert.match(SOURCE, /\.\.\.\(padding \? \{ padding \} : \{\}\)/,
    'the conditional spread is what keeps `padding` out of the options object');
});
