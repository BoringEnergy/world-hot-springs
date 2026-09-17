/**
 * The unknown-temperature share, said in words, from the data.
 *
 * The footer key said "4 in 5" and the welcome panel "Four springs in five",
 * both typed by hand (D10), next to a comment that still said "five in six"
 * from an earlier batch. They now call shareAsFraction and numberWords in
 * lib/format.ts, and so does the README test in docs.test.mjs, so the three
 * places cannot disagree with each other or with the data.
 *
 * Node imports the TypeScript directly by stripping its types.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { numberWords, shareAsFraction } from '../src/lib/format.ts';

test('a share is the plainest N in N+1 nearest to it', () => {
  assert.deepEqual(shareAsFraction(0.81), { part: 4, whole: 5 });
  assert.deepEqual(shareAsFraction(5 / 6), { part: 5, whole: 6 });
  assert.deepEqual(shareAsFraction(0.5), { part: 1, whole: 2 });
  assert.deepEqual(shareAsFraction(0.1), { part: 1, whole: 2 }, 'nothing below one in two is said this way');
  assert.deepEqual(shareAsFraction(0.99), { part: 9, whole: 10 }, 'nine in ten is the finest it goes');
});

test('the data today is four in five, and so is what the page derives', () => {
  // Not a pin on the number: a check that the helper and the summary meet.
  const summary = JSON.parse(fs.readFileSync('data/summary.json', 'utf8'));
  const unknown = 1 - summary.coverage.temperature / summary.total;
  const { part, whole } = shareAsFraction(unknown);
  assert.ok(Math.abs(part / whole - unknown) < 0.05, `${part} in ${whole} is not near ${(unknown * 100).toFixed(1)}%`);
});

test('numbers are written as prose writes them', () => {
  assert.equal(numberWords(4), 'four');
  assert.equal(numberWords(19), 'nineteen');
  assert.equal(numberWords(20), 'twenty');
  assert.equal(numberWords(21), 'twenty-one');
  assert.throws(() => numberWords(0), RangeError);
  assert.throws(() => numberWords(100), RangeError);
});

test('no component types the share it can derive', () => {
  const literal = /\b(?:\d|one|two|three|four|five|six|seven|eight|nine)\s+(?:springs\s+)?in\s+(?:\d|two|three|four|five|six|seven|eight|nine|ten)\b/i;
  for (const file of ['src/components/AtlasFooter.tsx', 'src/components/WelcomePanel.tsx']) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, literal, `${file} types the unknown share; derive it with shareAsFraction`);
    assert.match(text, /shareAsFraction\(/, `${file} no longer derives the unknown share`);
  }
  const legal = fs.readFileSync('src/components/LegalPages.tsx', 'utf8');
  assert.doesNotMatch(legal, /\b\w+ percent of these springs\b/i, 'LegalPages.tsx types the temperature share');
});
