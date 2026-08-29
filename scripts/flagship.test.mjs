import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFlagship, CANDIDATES_PER_COUNTRY, TARGET_PER_COUNTRY } from './lib/flagship.mjs';

// Country is at location.country, matching the real dataset. A fixture with a
// top-level `country` would make every test here pass while the real run
// selected nothing.
const s = (id, country, name, completeness) => ({
  id, name, location: { country }, quality: { completeness },
});

const springs = [
  s('whs_00000000000a', 'CL', 'A', 5),
  s('whs_00000000000b', 'CL', 'B', 3),
  s('whs_00000000000c', 'CL', null, 6),
  s('whs_00000000000d', 'BO', 'D', 1),
];

test('every country is represented, in sorted order', () => {
  // Not `.sort()` on the result -- that discards the signal. The fixture
  // supplies CL before BO, so comparing the raw order asserts sortedness,
  // which is what keeps the committed artifact diffable as the dataset grows.
  // With the sort applied to both sides, reversing the comparator passed.
  const sel = selectFlagship(springs);
  assert.deepEqual(sel.map((c) => c.country), ['BO', 'CL']);
});

test('a named spring outranks an unnamed one with higher completeness', () => {
  // An unnamed spring has nothing to search for; it is close to unenrichable.
  const cl = selectFlagship(springs).find((c) => c.country === 'CL');
  assert.equal(cl.candidates[0], 'whs_00000000000a');
  assert.equal(cl.candidates[2], 'whs_00000000000c');
});

test('candidates are capped per country', () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    s(`whs_${String(i).padStart(12, '0')}`, 'JP', `S${i}`, i));
  const jp = selectFlagship(many).find((c) => c.country === 'JP');
  // Assert *which* five, not just how many. Asserting only the length let
  // slice(0, N) become slice(-N) -- selecting the worst five -- and pass:
  // against the real dataset that changed 71 of 129 countries and collapsed
  // named candidates from 439 to 161, with the whole suite green.
  assert.deepEqual(jp.candidates, [
    'whs_000000000019', 'whs_000000000018', 'whs_000000000017',
    'whs_000000000016', 'whs_000000000015',
  ]);
  assert.equal(jp.candidates.length, CANDIDATES_PER_COUNTRY);
});

test('a spring with no country is skipped, not crashed on', () => {
  assert.deepEqual(selectFlagship([{ id: 'whs_00000000000e', name: 'E', quality: { completeness: 1 } }]), []);
});

test('a country with fewer springs than the cap contributes all of them', () => {
  const bo = selectFlagship(springs).find((c) => c.country === 'BO');
  assert.deepEqual(bo.candidates, ['whs_00000000000d']);
});

test('selection is deterministic', () => {
  assert.deepEqual(selectFlagship(springs), selectFlagship(springs.slice().reverse()));
});

test('ties break on id so ordering never depends on input order', () => {
  const tied = [s('whs_0000000000bb', 'PE', 'X', 4), s('whs_0000000000aa', 'PE', 'Y', 4)];
  assert.deepEqual(selectFlagship(tied)[0].candidates, ['whs_0000000000aa', 'whs_0000000000bb']);
});

test('the target is two per country', () => {
  assert.equal(TARGET_PER_COUNTRY, 2);
  assert.equal(CANDIDATES_PER_COUNTRY, 5);
});
