import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNcei, assertHash } from './lib/ncei.mjs';

const HEADER = '# source: https://example.invalid/x.xlsx\nstate\tlat\tlng\tname\ttf\ttc\n';

test('a numeric row whose Fahrenheit and Celsius agree is accepted', () => {
  const { springs, rejected } = parseNcei(
    HEADER + 'AK\t55.983\t-131.661\tBAILEY HOT SPRING\t198\t92\n',
  );
  assert.equal(rejected.length, 0);
  assert.deepEqual(springs, [
    {
      state: 'AK',
      lat: 55.983,
      lng: -131.661,
      name: 'BAILEY HOT SPRING',
      celsius: 92,
      qualitative: null,
    },
  ]);
});

test('a qualitative row keeps the word and carries no number', () => {
  const { springs } = parseNcei(
    HEADER + 'AK\t52.84\t-169.9\tCHUGINADAK HOT SPRINGS\tH\tH\n',
  );
  assert.equal(springs[0].celsius, null);
  assert.equal(springs[0].qualitative, 'hot');
});

test('every qualitative code maps to the vocabulary normalize.mjs already uses', () => {
  const rows = 'AK\t1\t1\tA\tB\tB\nAK\t2\t2\tB\tH\tH\nAK\t3\t3\tC\tW\tW\n';
  const { springs } = parseNcei(HEADER + rows);
  assert.deepEqual(
    springs.map((s) => s.qualitative),
    ['boiling', 'hot', 'warm'],
  );
});

test('a row whose Celsius contradicts its Fahrenheit is rejected, not imported', () => {
  // 198F is 92C. A row claiming 40C is mis-sliced or the source disagrees with
  // itself; either way it must not reach the atlas silently.
  const { springs, rejected } = parseNcei(HEADER + 'AK\t55.9\t-131.6\tBAD ROW\t198\t40\n');
  assert.equal(springs.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /disagree/);
});

test('a name containing digits does not get read as the temperature', () => {
  // Real rows: "SPRING 1 (HUGHES)" and "SPRING 1 (RENO)". A parser that stops
  // at the first numeric token slices the name in half and imports "1" as F.
  const { springs } = parseNcei(HEADER + 'NV\t39.5\t-119.8\tSPRING 1 (RENO)\t120\t49\n');
  assert.equal(springs[0].name, 'SPRING 1 (RENO)');
  assert.equal(springs[0].celsius, 49);
});

test('comment and blank lines are ignored', () => {
  const { springs } = parseNcei(HEADER + '\n# a note\nAK\t1\t2\tX\t212\t100\n\n');
  assert.equal(springs.length, 1);
});

test('a row with an unparseable coordinate is rejected', () => {
  const { springs, rejected } = parseNcei(HEADER + 'AK\tnorth\t-131\tX\t198\t92\n');
  assert.equal(springs.length, 0);
  assert.match(rejected[0].reason, /coordinate/);
});

test('the pin accepts the exact bytes', () => {
  const sha = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  assert.equal(assertHash(Buffer.from('hello'), sha), sha);
});

test('the pin refuses anything else, and says what to do about it', () => {
  assert.throws(
    () =>
      assertHash(
        Buffer.from('hello!'),
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      ),
    /sha256 mismatch[\s\S]*read the diff/,
  );
});
