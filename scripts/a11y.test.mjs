/**
 * What the page tells a reader who cannot see it.
 *
 * Source guards, in the style of mapview.test.mjs and for the same reason:
 * `npm test` runs only scripts/ ** /*.test.mjs and there is no React harness
 * here, so these cannot prove the app renders. They can stop three specific
 * defects coming back, and each one is written against the mistake rather than
 * against the markup, so reformatting the JSX does not fail them.
 *
 * Regression: ISSUE-003 -- no h1, no landmark, and a spring count that changed
 * silently.
 * Found by /qa on 2026-09-11.
 * Report: .gstack/qa-reports/qa-report-localhost-2026-09-11.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const APP = fs.readFileSync('src/App.tsx', 'utf8');
const HEADER = fs.readFileSync('src/components/Header.tsx', 'utf8');

test('the atlas is a landmark, not an anonymous div', () => {
  // Without <main> the only way into the map is tabbing through every header
  // control, on every visit.
  assert.match(APP, /<main\b/);
  assert.match(APP, /<\/main>/);
});

test('the page has a top-level heading', () => {
  // The heading list used to start at the filter rail's "Filters" h2, inside a
  // panel that is closed by default -- so on arrival there were no headings at
  // all.
  assert.match(HEADER, /<h1\b[^>]*>World Hot Springs<\/h1>/);
  // Visually hidden, not display:none. `hidden` would take it out of the
  // accessibility tree too and leave the page exactly as it was.
  assert.match(HEADER, /<h1 className="sr-only"/);
});

test('the spring count is announced, and the announced copy is always rendered', () => {
  // The defect was subtler than a missing aria-live. The count lived in a span
  // classed `hidden ... md:inline`, and a live region inside display:none
  // announces nothing -- so putting aria-live on that span would have looked
  // like a fix while staying silent on every phone.
  const status = /<span role="status" aria-live="polite" className="sr-only">/;
  assert.match(HEADER, status);

  const liveBlock = HEADER.slice(HEADER.search(status));
  assert.ok(!/\bhidden\b/.test(liveBlock.split('</span>')[0]), 'the live region must not be display-gated');

  // And the visible span is now decorative, so the count is not read twice.
  assert.match(HEADER, /<span aria-hidden className="hidden shrink-0/);
});

test('polite, so search-as-you-type does not read a total per keystroke', () => {
  assert.ok(!/aria-live="assertive"/.test(HEADER));
});
