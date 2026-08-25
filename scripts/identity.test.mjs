import test from 'node:test';
import assert from 'node:assert/strict';
import { osmType, osmRefOf, isSameSpring, mintId, resolveRegistry } from './lib/identity.mjs';

const at = (lat, lng, name = null, id = 'osm-node-1') => ({ id, name, location: { lat, lng } });

test('osmType reads the element type out of a record id', () => {
  assert.equal(osmType('osm-node-123'), 'node');
  assert.equal(osmType('osm-way-456'), 'way');
  assert.equal(osmType('osm-relation-789'), 'relation');
});

test('osmRefOf converts a record id to an OSM reference', () => {
  assert.equal(osmRefOf('osm-node-123'), 'node/123');
  assert.equal(osmRefOf('osm-relation-789'), 'relation/789');
});

test('identical names merge up to 300m apart', () => {
  const a = at(-39.826478, -71.636675, 'Termas de Lahuen Co', 'osm-node-1');
  const b = at(-39.824, -71.6355, 'Termas de Lahuen Co', 'osm-node-2');
  assert.equal(isSameSpring(a, b), true);
});

test('identical names beyond 300m stay separate', () => {
  const a = at(-39.826478, -71.636675, 'Termas de Lahuen Co', 'osm-node-1');
  const b = at(-39.822813, -71.633676, 'Termas de Lahuen Co', 'osm-node-2');
  assert.equal(isSameSpring(a, b), false);
});

test('a substring name match keeps the tight 60m radius', () => {
  const near = at(64.048, -21.2222, 'Blue Spring', 'osm-node-1');
  const far = at(64.049, -21.2222, 'Blue Spring Lodge', 'osm-node-2');
  assert.equal(isSameSpring(near, at(64.0481, -21.2222, 'Blue Spring Lodge', 'osm-node-2')), true);
  assert.equal(isSameSpring(near, far), false);
});

test('a short name substring match at tens of metres is coincidence, not identity', () => {
  // "No. 4" -> "no4", "No. 4b" -> "no4b". no4b contains no4, but a 3-4
  // character token matching inside a longer name is coincidence far more
  // often than signal once the records aren't right on top of each other
  // (measured: "No. 4" / "No. 4b" sit 62m apart in the real dataset --
  // distinct numbered pools, saved only by being just outside the 60m
  // radius). At ~44m -- well past ANONYMOUS_METERS but inside
  // SAME_FEATURE_METERS -- a short name no longer supplies enough evidence.
  const a = at(64.048, -21.2222, 'No. 4', 'osm-node-1');
  const b = at(64.0484, -21.2222, 'No. 4b', 'osm-node-2');
  assert.equal(isSameSpring(a, b), false);
});

test('a short name inside a longer name at tens of metres does not match', () => {
  const a = at(64.048, -21.2222, 'Spa', 'osm-node-1');
  const b = at(64.0484, -21.2222, 'Big Spa Resort', 'osm-node-2');
  assert.equal(isSameSpring(a, b), false);
});

test('same distance, same substring relationship, opposite outcome by name length alone', () => {
  // Both pairs sit ~44m apart -- past ANONYMOUS_METERS (12m) but inside
  // SAME_FEATURE_METERS (60m) -- and both are a substring match. The only
  // difference is name length either side of MIN_SUBSTRING_NAME_LENGTH (4),
  // which is exactly what should decide the outcome here.
  const shortA = at(64.048, -21.2222, 'Spa', 'osm-node-1');
  const shortB = at(64.0484, -21.2222, 'Big Spa Resort', 'osm-node-2');
  assert.equal(isSameSpring(shortA, shortB), false, 'short name at 44m: too far for weak evidence');

  // "Alpha" normalises to exactly 5 characters, so this also tests the
  // length boundary from the eligible side (> MIN_SUBSTRING_NAME_LENGTH).
  const longA = at(64.048, -21.2223, 'Alpha', 'osm-node-1');
  const longB = at(64.0484, -21.2223, 'Alpha Lodge', 'osm-node-2');
  assert.equal(isSameSpring(longA, longB), true, 'long name at 44m: within the ordinary 60m radius');
});

test('a short name inside a longer name at a few metres does match', () => {
  // Real dataset fixture: 風の湯 ("no-of-yu", a complete 3-character Japanese
  // name) sits ~3m from a record named SOLA SPA 風の湯. Short names are
  // complete names, not fragments -- near-coincident position is enough
  // evidence that these are the same feature.
  const a = at(64.048, -21.2222, '風の湯', 'osm-node-1');
  const b = at(64.04803, -21.2222, 'SOLA SPA 風の湯', 'osm-node-2');
  assert.equal(isSameSpring(a, b), true);
});

test('exact equality still matches for short names, regardless of length', () => {
  const a = at(35.0, 135.0, '株湯', 'osm-node-1');
  const b = at(35.0009, 135.0, '株湯', 'osm-node-2');
  assert.equal(isSameSpring(a, b), true);
});

test('substring matching still works for genuinely long names', () => {
  const a = at(64.048, -21.2222, 'Blue Spring', 'osm-node-1');
  const b = at(64.0481, -21.2222, 'Blue Spring Lodge', 'osm-node-2');
  assert.equal(isSameSpring(a, b), true);
});

test('one named and one unnamed merge only across different element types', () => {
  const node = at(64.048, -21.2222, 'Reykjadalur', 'osm-node-1');
  const way = at(64.0482, -21.2222, null, 'osm-way-2');
  const otherNode = at(64.0482, -21.2222, null, 'osm-node-3');
  assert.equal(isSameSpring(node, way), true, 'source and pool are one spring');
  assert.equal(isSameSpring(node, otherNode), false, 'two separately mapped nodes are two springs');
});

test('two anonymous records merge only within 12m', () => {
  const a = at(44.6, -110.5, null, 'osm-node-1');
  const close = at(44.60005, -110.5, null, 'osm-node-2');
  const apart = at(44.6003, -110.5, null, 'osm-node-3');
  assert.equal(isSameSpring(a, close), true);
  assert.equal(
    isSameSpring(a, apart),
    false,
    'distinct springs sit metres apart in a geyser basin; merging them deletes real data',
  );
});

const rec = (id, lat, lng, name, sources = []) => ({
  id,
  name,
  location: { lat, lng },
  sources: sources.length ? sources : [`https://www.openstreetmap.org/${osmRefOf(id)}`],
});

test('mintId is deterministic and prefixed', () => {
  const a = mintId('node/4702109263');
  assert.match(a, /^whs_[0-9a-f]{12}$/);
  assert.equal(a, mintId('node/4702109263'), 'same ref must always mint the same id');
  assert.notEqual(a, mintId('node/4702109264'));
});

test('resolveRegistry mints ids for a first run', () => {
  const records = [rec('osm-node-1', 64.048, -21.2222, 'Reykjadalur')];
  const { registry, assignments, events } = resolveRegistry(records, {}, '2026-08-25');
  const id = assignments.get('osm-node-1');
  assert.match(id, /^whs_/);
  assert.equal(registry[id].osmRefs[0], 'node/1');
  assert.equal(registry[id].firstSeen, '2026-08-25');
  assert.equal(events.filter((e) => e.type === 'spring.appeared').length, 1);
});

test('resolveRegistry reuses an id when the OSM ref is unchanged', () => {
  const records = [rec('osm-node-1', 64.048, -21.2222, 'Reykjadalur')];
  const first = resolveRegistry(records, {}, '2026-08-25');
  const id = first.assignments.get('osm-node-1');
  const second = resolveRegistry(records, first.registry, '2026-09-01');
  assert.equal(second.assignments.get('osm-node-1'), id);
  assert.equal(second.registry[id].firstSeen, '2026-08-25', 'firstSeen must not move');
  assert.equal(second.registry[id].lastSeen, '2026-09-01');
  assert.equal(second.events.filter((e) => e.type === 'spring.appeared').length, 0);
});

test('resolveRegistry keeps the id when OSM redraws the spring under a new ref', () => {
  const before = [rec('osm-node-1', 64.048, -21.2222, 'Reykjadalur')];
  const first = resolveRegistry(before, {}, '2026-08-25');
  const id = first.assignments.get('osm-node-1');

  // Same spring, same name, 40m away, remapped as a way with a brand new id.
  const after = [rec('osm-way-99', 64.0484, -21.2222, 'Reykjadalur')];
  const second = resolveRegistry(after, first.registry, '2026-09-01');

  assert.equal(second.assignments.get('osm-way-99'), id, 'a redraw must not orphan claims');
  assert.ok(second.registry[id].osmRefs.includes('way/99'));
  assert.ok(second.registry[id].osmRefs.includes('node/1'), 'the old ref is retained');
});

test('a spring that vanishes upstream is flagged, never deleted', () => {
  const before = [rec('osm-node-1', 64.048, -21.2222, 'Reykjadalur')];
  const first = resolveRegistry(before, {}, '2026-08-25');
  const id = first.assignments.get('osm-node-1');

  const second = resolveRegistry([], first.registry, '2026-09-01');
  assert.ok(second.registry[id], 'the entry survives');
  assert.equal(second.registry[id].missingSince, '2026-09-01');
  assert.equal(second.events.filter((e) => e.type === 'spring.disappeared').length, 1);
});

test('disappearance is reported once, not on every later build', () => {
  const first = resolveRegistry([rec('osm-node-1', 64.048, -21.2222, 'X')], {}, '2026-08-25');
  const second = resolveRegistry([], first.registry, '2026-09-01');
  const third = resolveRegistry([], second.registry, '2026-10-01');
  assert.equal(third.events.filter((e) => e.type === 'spring.disappeared').length, 0);
  const id = first.assignments.get('osm-node-1');
  assert.equal(third.registry[id].missingSince, '2026-09-01', 'the original date is kept');
});

test('a returning spring clears its missing flag', () => {
  const records = [rec('osm-node-1', 64.048, -21.2222, 'X')];
  const first = resolveRegistry(records, {}, '2026-08-25');
  const gone = resolveRegistry([], first.registry, '2026-09-01');
  const back = resolveRegistry(records, gone.registry, '2026-10-01');
  const id = first.assignments.get('osm-node-1');
  assert.equal(back.registry[id].missingSince, null);
});
