/**
 * The numbers in the README must match the build that produced them.
 *
 * They drifted: the README claimed 6,470 while summary.json said 6,471. A
 * count nobody checks is a count that quietly becomes wrong, and it is the
 * first number a stranger reads about this project.
 *
 * Plain string comparison rather than regex, deliberately -- the assertion
 * message can then print the exact line the README should contain, which is
 * the whole value of the test when it fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { numberWords, springsInWords } from '../src/lib/format.ts';

const README = fs.readFileSync('README.md', 'utf8');
const SUMMARY = JSON.parse(fs.readFileSync('data/summary.json', 'utf8'));

test('the README headline count matches summary.json', () => {
  const want = `**${SUMMARY.total.toLocaleString('en-US')} springs across ${SUMMARY.countries} countries**`;
  assert.ok(README.includes(want), `README should contain: ${want}`);
});

test('the README coverage table matches summary.json', () => {
  // Rounded to whole percent, as the table presents them. The temperature row
  // is bolded in the README because 1% is the point the whole project makes.
  const rows = [
    ['Temperature', 'temperature', true],
    ['Price', 'price', false],
    ['Hours', 'hours', false],
    ['Clothing policy', 'clothing', false],
  ];
  for (const [label, field, bold] of rows) {
    const pct = Math.round((SUMMARY.coverage[field] / SUMMARY.total) * 100);
    const cell = bold ? `**${pct}%**` : `${pct}%`;
    const want = `| ${label} | ${cell} |`;
    assert.ok(
      README.includes(want),
      `README should contain: ${want}  (${SUMMARY.coverage[field]} of ${SUMMARY.total})`,
    );
  }
});

test('CONTRIBUTING does not tell contributors to use an OSM id', () => {
  // Identities are whs_ + 12 hex. The old `osm-node-123456789` example
  // produced invalid submissions from anyone who read only that section.
  const CONTRIBUTING = fs.readFileSync('CONTRIBUTING.md', 'utf8');
  assert.ok(!CONTRIBUTING.includes('osm-node-'), 'use a whs_ id in examples');
});

/**
 * The sentences around the table, which were typed by hand and went stale.
 *
 * The README said "five springs in six" and "1,097 of 2,849" long after the
 * batches that moved both, because nothing recounted them. These tests
 * rebuild each sentence from the data and compare it whole, with the line
 * breaks folded away, so the message on failure is the sentence to paste.
 */
const PROSE = README.replace(/\s+/g, ' ');

// The same words and fraction the footer and the welcome panel render.
const words = numberWords;
const count = (n) => n.toLocaleString('en-US');

test('the README\'s United States sentence is a recount of the data', () => {
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const measured = (s) => s.temperature.celsius !== null;
  const us = all.filter((s) => s.location.country === 'US');
  const rest = all.filter((s) => s.location.country !== 'US');
  const usT = us.filter(measured).length;
  const restT = rest.filter(measured).length;
  // "under N%" is the next whole percent above the share, so it stays true
  // when the share is itself a whole number.
  const under = Math.floor((restT / rest.length) * 100) + 1;
  const want =
    `where ${count(usT)} of ${count(us.length)} springs carry a temperature. ` +
    `Everywhere else it is ${count(restT)} of ${count(rest.length)} — under ${under}%, ` +
    `about one spring in ${words(Math.round(rest.length / restT))}.`;
  assert.ok(PROSE.includes(want), `README should contain: ${want}`);
});

test('the README\'s unknown share is derived from the summary', () => {
  // Said as "N springs in N+1", the plainest fraction nearest the true share.
  const unknown = 1 - SUMMARY.coverage.temperature / SUMMARY.total;
  const want = `${springsInWords(unknown)} have no recorded temperature.`;
  assert.ok(PROSE.includes(want), `README should contain: ${want}  (${(unknown * 100).toFixed(1)}% unknown)`);

  const pct = Math.round((SUMMARY.coverage.temperature / SUMMARY.total) * 100);
  const v1 = `${pct}% of these springs have a recorded temperature because ${100 - pct}% of them have never had one published`;
  assert.ok(PROSE.includes(v1), `README should contain: ${v1}`);
});

test('LICENSE defers to DATA.md for the upstreams, and states ODbL', () => {
  // The note credited OpenStreetMap alone, after four more upstreams and one
  // licence that makes attribution a condition. It now names no upstream at
  // all, so it cannot fall behind the list again.
  const LICENSE = fs.readFileSync('LICENSE', 'utf8');
  const note = LICENSE.slice(LICENSE.indexOf('NOTE ON THE DATASET'));
  assert.ok(note.length < LICENSE.length, 'LICENSE has lost its dataset note');
  assert.match(note, /Open Database License \(ODbL\) v1\.0/);
  assert.ok(note.includes('https://opendatacommons.org/licenses/odbl/1-0/'));
  assert.match(note, /DATA\.md/);
  assert.ok(!/derived from OpenStreetMap/.test(note), 'that sentence was true once and is not now');
  assert.ok(!note.includes('OpenStreetMap'), 'name upstreams in DATA.md, not here');
});

test('docs/DATA.md points at the upstream list and its diagram names every enrichment stage', () => {
  const DOC = fs.readFileSync('docs/DATA.md', 'utf8');
  const start = DOC.indexOf('## Upstreams');
  assert.ok(start !== -1, 'docs/DATA.md has lost its upstream section');
  const section = DOC.slice(start, DOC.indexOf('\n## ', start + 1));
  assert.ok(section.includes('](../DATA.md)'), 'the section must link the real list');
  assert.ok(!/^\|/m.test(section), 'a second upstream table is a second copy of the list');

  // Every matcher in scripts/lib is a pipeline stage, and the diagram is the
  // one place a reader sees the order they run in.
  const diagram = DOC.slice(DOC.indexOf('## Pipeline'), start);
  const matchers = fs.readdirSync('scripts/lib').filter((f) => f.endsWith('-match.mjs'));
  assert.ok(matchers.length >= 4, `expected the four matchers, found ${matchers}`);
  for (const f of matchers) {
    assert.ok(diagram.includes(`(scripts/lib/${f})`), `the pipeline diagram does not name scripts/lib/${f}`);
  }
});

test('PRIVACY.md says what removal cannot reach', () => {
  // An archived DOI snapshot is immutable. Promising permanent removal while
  // archiving versions that removal cannot touch would be a promise this
  // project knows it cannot keep.
  const PRIVACY = fs.readFileSync('PRIVACY.md', 'utf8');
  const start = PRIVACY.indexOf('## Archived versions');
  assert.ok(start !== -1, 'PRIVACY.md has no "Archived versions" section');
  const section = PRIVACY.slice(start, PRIVACY.indexOf('\n## ', start + 1));
  assert.match(section, /Zenodo/);
  assert.match(section, /immutable/);
  assert.match(section, /processed before any release/);
  assert.match(section, /restrict access/);
  // And the promise it qualifies is still made, unweakened.
  assert.ok(PRIVACY.includes('Removal is the default answer, it is permanent'));
});

test('the release archive leaves out the agent tooling', () => {
  // `git archive` is what GitHub serves as a release's source tarball, and so
  // what Zenodo archives. `.claude/launch.json` was in it.
  const ATTR = fs.readFileSync('.gitattributes', 'utf8');
  assert.match(ATTR, /^\.claude\/ export-ignore$/m);
});
