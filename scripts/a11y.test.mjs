/**
 * What the page tells a reader who cannot see it.
 *
 * Source guards, in the style of mapview.test.mjs: `npm test` runs only
 * scripts/ ** /*.test.mjs and never opens a browser, so these cannot prove the
 * app renders. That is the browser harness's job (e2e/, `npm run test:e2e`,
 * since 2026-09-16), which checks the rendered page at real widths. These stay
 * as the fast first line: they stop three specific defects coming back, and
 * each one is written against the mistake rather than against the markup, so
 * reformatting the JSX does not fail them.
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
  assert.match(HEADER, /<h1\b[^>]*>\s*World Hot Springs\s*<\/h1>/);
});

test('the heading is a visible wordmark, not a screen-reader-only one', () => {
  // ISSUE-003's fix was `sr-only`, which was right for an accessibility patch
  // and wrong as a permanent answer: it left the page showing no name at all,
  // so a sighted first-time visitor got a dark globe and a filter button and
  // no statement of what they were looking at. The heading is now rendered.
  //
  // Written against the mistake rather than the markup: the guard is that the
  // h1 is not hidden from everyone, not that any particular class is present.
  const h1 = HEADER.slice(HEADER.indexOf('<h1'), HEADER.indexOf('</h1>'));
  assert.ok(!/\bsr-only\b/.test(h1), 'the wordmark must be visible, not sr-only');
  assert.ok(!/\bhidden\b/.test(h1), 'the wordmark must not be display-gated at every width');
});

/**
 * The opening tags that enclose `index` in `jsx`, outermost first.
 *
 * A tag ends at the first `>` outside braces and quotes, because an
 * attribute like `onClick={(e) => ...}` carries its own `>`.
 */
function enclosingTags(jsx, index) {
  const stack = [];
  let i = 0;
  while (i < index) {
    const lt = jsx.indexOf('<', i);
    if (lt < 0 || lt >= index) break;
    const closing = jsx[lt + 1] === '/';
    if (!/^[A-Za-z]/.test(jsx.slice(lt + (closing ? 2 : 1)))) {
      i = lt + 1;
      continue;
    }
    let j = lt + 1;
    let depth = 0;
    let quote = null;
    for (; j < jsx.length; j++) {
      const ch = jsx[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    const tag = jsx.slice(lt, j + 1);
    if (closing) stack.pop();
    else if (!tag.endsWith('/>')) stack.push(tag);
    i = j + 1;
  }
  return stack;
}

test('nothing around the h1 takes it out of the accessibility tree at any width', () => {
  // The test above looks at the h1 and nowhere else, and it passed while the
  // h1 sat inside a `hidden md:flex` span: display:none on a parent removes
  // the heading too, so a phone had no h1 (D1, found by the browser harness
  // on 2026-09-16). `hidden` under any breakpoint prefix does the same at
  // that width. `sr-only` on a parent is the honest way to hide the words and
  // keep the heading, but only if some width shows the words again.
  const body = HEADER.slice(HEADER.indexOf('return ('));
  const tags = enclosingTags(body, body.indexOf('<h1'));
  assert.ok(tags.some((t) => t.startsWith('<header')), 'the h1 is no longer inside the header');
  for (const tag of tags) {
    const classes = (tag.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/) ?? []).slice(1).join(' ').split(/\s+/);
    const gate = classes.find((c) => /^(?:[\w-]+:)*hidden$/.test(c));
    assert.ok(!gate, `\`${gate}\` on ${tag.slice(0, 60)}... hides the h1 with it`);
    if (classes.includes('sr-only')) {
      assert.ok(
        classes.some((c) => /^[\w-]+:not-sr-only$/.test(c)),
        `${tag.slice(0, 60)}... is sr-only at every width, so the wordmark is never seen`,
      );
    }
  }
});

test('the masthead credits the lab that publishes the atlas', () => {
  // Provenance is the product here, and that includes the atlas's own. A
  // dataset asking to be cited says who publishes it on the page, not only in
  // CITATION.cff where nobody looks.
  // The address is read from src/lib/citation.ts, the same line CITATION.cff
  // names the publisher's site from, so the two cannot disagree.
  assert.match(HEADER, /href=\{PUBLISHER_URL\}/);
  assert.match(HEADER, /import \{ PUBLISHER_URL \} from '\.\.\/lib\/citation\.ts'/);
  assert.match(fs.readFileSync('src/lib/citation.ts', 'utf8'), /PUBLISHER_URL = 'https:\/\/hudsonrnd\.com'/);
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
