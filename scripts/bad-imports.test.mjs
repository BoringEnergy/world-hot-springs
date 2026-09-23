import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileBadImports, matchBadImport, unmatchedIds } from './lib/bad-imports.mjs';

const rec = ({ id = 'osm-node-1', country = 'XX', lat = 10, lng = 20, name = 'x', attributeFree = true } = {}) => ({
  id,
  name,
  location: { country, lat, lng },
  quality: attributeFree ? { attributeFree: true } : {},
});

const file = (...imports) => ({ imports: imports.map((i) => ({ reason: 'r', countries: ['XX'], ...i })) });
const one = (imp, r) => matchBadImport(compileBadImports(file(imp)), r)?.id ?? null;

test('attribute-free matches an attribute-free record in the country, and only that', () => {
  const imp = { id: 'a', rule: 'attribute-free' };
  assert.equal(one(imp, rec()), 'a');
  assert.equal(one(imp, rec({ attributeFree: false })), null);
  assert.equal(one(imp, rec({ country: 'YY' })), null);
});

test('a bbox confines an entry to its box', () => {
  const imp = { id: 'a', rule: 'attribute-free', bbox: [19, 9, 21, 11] };
  assert.equal(one(imp, rec()), 'a');
  assert.equal(one(imp, rec({ lng: 22 })), null);
  assert.equal(one(imp, rec({ lat: 8 })), null);
});

test('name-pattern matches on the name whatever the attributes, and never on an absent name', () => {
  const imp = { id: 'a', rule: 'name-pattern', namePattern: '^C300\\d{4}\\b' };
  assert.equal(one(imp, rec({ name: 'C3005333 Ait Bouyoussef Said', attributeFree: false })), 'a');
  assert.equal(one(imp, rec({ name: 'c3005533 ait bouyoussef' })), 'a', 'case-insensitive');
  assert.equal(one(imp, rec({ name: 'Hammam Najd' })), null);
  assert.equal(one(imp, rec({ name: null })), null);
});

test('listed matches exactly the named records', () => {
  const imp = { id: 'a', rule: 'listed', ids: ['osm-node-7'] };
  assert.equal(one(imp, rec({ id: 'osm-node-7', attributeFree: false })), 'a');
  assert.equal(one(imp, rec({ id: 'osm-node-70' })), null);
});

test('except protects a reviewed genuine spring inside an entry', () => {
  const imp = { id: 'a', rule: 'attribute-free', except: ['osm-node-2'] };
  assert.equal(one(imp, rec({ id: 'osm-node-2' })), null);
  assert.equal(one(imp, rec({ id: 'osm-node-3' })), 'a');
});

test('a malformed entry is refused, never silently matching nothing', () => {
  const bad = [
    [{ id: 'a', rule: 'clever-heuristic' }, /unknown rule/],
    [{ id: 'a', rule: 'name-pattern' }, /namePattern/],
    [{ id: 'a', rule: 'attribute-free', namePattern: 'x' }, /would ignore/],
    [{ id: 'a', rule: 'listed' }, /"ids"/],
    [{ id: 'a', rule: 'listed', ids: ['x', 'x'] }, /repeats/],
    [{ id: 'a', rule: 'attribute-free', ids: ['x'] }, /would ignore/],
    [{ id: 'a', rule: 'attribute-free', bbox: [1, 2, 3] }, /bbox/],
    [{ id: 'a', rule: 'attribute-free', bbox: [3, 2, 1, 4] }, /minimum above/],
    [{ id: 'a', rule: 'attribute-free', except: [] }, /"except"/],
    [{ id: 'a', rule: 'attribute-free', countries: [] }, /no countries/],
    [{ id: 'a', rule: 'attribute-free', reason: '' }, /no reason/],
  ];
  for (const [imp, why] of bad) assert.throws(() => compileBadImports(file(imp)), why, JSON.stringify(imp));
  assert.throws(
    () => compileBadImports(file({ id: 'a', rule: 'listed', ids: ['x'] }, { id: 'a', rule: 'listed', ids: ['y'] })),
    /duplicate id/,
  );
});

test('unmatchedIds reports a listed or excepted id no record carries', () => {
  const compiled = compileBadImports(
    file({ id: 'a', rule: 'listed', ids: ['osm-node-1', 'osm-node-9'] }, { id: 'b', rule: 'attribute-free', except: ['osm-node-8'] }),
  );
  assert.deepEqual(unmatchedIds(compiled, [rec()]), ['a: osm-node-9', 'b: osm-node-8']);
});

test('the committed list compiles', () => {
  const compiled = compileBadImports(JSON.parse(fs.readFileSync('data/known-bad-imports.json', 'utf8')));
  assert.ok(compiled.length >= 4);
});
