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

test('resolveRegistry throws on a mintId hash collision instead of silently conflating two springs', () => {
  // This guards against a hash collision, not any expected condition: two
  // different OSM refs are not supposed to ever mint the same id, but the id
  // space is finite, so we force one here by pre-seeding the registry with
  // the exact id mintId('node/1') would produce, attached to an unrelated
  // ref and centroid. A collision must be loud, never silent -- silently
  // reusing the id would conflate two distinct springs permanently.
  const collidingId = mintId('node/1');
  const registry = {
    [collidingId]: {
      osmRefs: ['node/999999'],
      centroid: [10, 20],
      name: 'Some Other Spring',
      firstSeen: '2026-01-01',
      lastSeen: '2026-01-01',
      missingSince: null,
    },
  };
  const records = [rec('osm-node-1', 64.048, -21.2222, 'Totally Unrelated Spring')];
  assert.throws(() => resolveRegistry(records, registry, '2026-08-25'), /collision/i);
});

test('a merged duplicate carries both OSM refs, and the secondary ref alone still resolves to the same id', () => {
  // This is what Task 2's dedupe produces when it merges a node and a way
  // into one record: the primary id is one ref, and the other survives only
  // in `sources`. refsOf must pick both up.
  const merged = {
    id: 'osm-node-1',
    name: 'Reykjadalur',
    location: { lat: 64.048, lng: -21.2222 },
    sources: ['https://www.openstreetmap.org/node/1', 'https://www.openstreetmap.org/way/55'],
  };
  const first = resolveRegistry([merged], {}, '2026-08-25');
  const id = first.assignments.get('osm-node-1');
  assert.ok(first.registry[id].osmRefs.includes('node/1'));
  assert.ok(first.registry[id].osmRefs.includes('way/55'));

  // The redraw-survival property, reached through a merged duplicate's
  // secondary ref rather than through the primary id.
  const laterRecord = rec('osm-way-55', 64.048, -21.2222, 'Reykjadalur');
  const second = resolveRegistry([laterRecord], first.registry, '2026-09-01');
  assert.equal(second.assignments.get('osm-way-55'), id, 'the secondary ref alone must resolve to the same durable id');
});

// --- spatial index over the registry fallback ---
// The fallback is bucketed rather than linear. These pin that bucketing never
// hides a match the linear scan would have found.

function seededRegistry(lat, lng, name) {
  const first = resolveRegistry(
    [{ id: 'osm-node-1', name, location: { lat, lng },
       sources: ['https://www.openstreetmap.org/node/1'] }],
    {}, '2026-01-01',
  );
  return { registry: first.registry, id: first.assignments.get('osm-node-1') };
}

test('the fallback still matches across a cell boundary', () => {
  // 0.002 degrees of latitude is ~222m: inside EXACT_NAME_METERS but far
  // enough to land in a different 0.01-degree cell than the registry entry.
  const { registry, id } = seededRegistry(64.0095, -21.2222, 'Reykjadalur');
  const moved = resolveRegistry(
    [{ id: 'osm-way-77', name: 'Reykjadalur', location: { lat: 64.0115, lng: -21.2222 },
       sources: ['https://www.openstreetmap.org/way/77'] }],
    registry, '2026-02-01',
  );
  assert.equal(moved.assignments.get('osm-way-77'), id, 'a cell boundary must not hide a match');
});

test('the fallback still matches near the pole, where longitude cells narrow', () => {
  // At 89N a 0.01-degree longitude cell is about 19m wide, so a fixed one-cell
  // search would miss a match 250m away. The column span is computed from the
  // latitude for exactly this case.
  const { registry, id } = seededRegistry(89.0, 10.0, 'Polar Spring');
  const nearby = resolveRegistry(
    [{ id: 'osm-way-78', name: 'Polar Spring', location: { lat: 89.0, lng: 10.1 },
       sources: ['https://www.openstreetmap.org/way/78'] }],
    registry, '2026-02-01',
  );
  assert.equal(nearby.assignments.get('osm-way-78'), id, '0.1 lng at 89N is ~194m, well inside 300m');
});

test('the fallback does not match beyond the search radius', () => {
  const { registry, id } = seededRegistry(64.048, -21.2222, 'Reykjadalur');
  const far = resolveRegistry(
    [{ id: 'osm-way-79', name: 'Reykjadalur', location: { lat: 64.1, lng: -21.2222 },
       sources: ['https://www.openstreetmap.org/way/79'] }],
    registry, '2026-02-01',
  );
  assert.notEqual(far.assignments.get('osm-way-79'), id, '5.8km apart is a different spring');
});

// --- source-independent identity: the two defensive fixes ---
// Both defects are silent and permanent. One turns every non-OSM record into
// the same merge key; the other lets a refless registry entry pose as a node.

import { SAME_FEATURE_METERS } from './lib/identity.mjs';
import { distanceMeters } from './lib/geo.mjs';
import { normalizeElement } from './lib/normalize.mjs';

test('osmRefOf and osmType refuse an id that is not OSM-shaped', () => {
  // The synthesised ref is the defect. `'usgs:P96Q13U3'.split('-')` yields no
  // type and no number, and the old code interpolated both anyway, producing
  // the string 'undefined/undefined'.
  for (const id of ['usgs:P96Q13U3', 'usgs-sample-9', 'whs_abc123', 'osm-node-', 'osm-node-12a', 'osm-node-1-2', '']) {
    assert.equal(osmRefOf(id), null, `${id} is not OSM-shaped`);
    assert.equal(osmType(id), null, `${id} is not OSM-shaped`);
  }
  assert.equal(osmRefOf('osm-node-123'), 'node/123');
  assert.equal(osmRefOf('osm-way-456'), 'way/456');
  assert.equal(osmRefOf('osm-relation-789'), 'relation/789');
  assert.equal(osmType('osm-node-123'), 'node');
  assert.equal(osmType('osm-way-456'), 'way');
  assert.equal(osmType('osm-relation-789'), 'relation');
});

test('two non-OSM records 3,000km apart resolve to two entries, contributing no refs', () => {
  // Measured against the unfixed code: ONE entry, whs_2098f7a355ba, osmRefs
  // ['undefined/undefined'], named "Omega" at Omega's centroid -- Alpha's name
  // and position overwritten, and both records stamped with the same id.
  const alpha = { id: 'usgs:P96Q13U3', name: 'Alpha', location: { lat: 44.6, lng: -110.5 }, sources: [] };
  const omega = { id: 'usgs:ZZZ999', name: 'Omega', location: { lat: 10.0, lng: 20.0 }, sources: [] };
  const { registry, assignments } = resolveRegistry([alpha, omega], {}, '2026-09-03');

  const alphaId = assignments.get('usgs:P96Q13U3');
  const omegaId = assignments.get('usgs:ZZZ999');
  assert.notEqual(alphaId, omegaId, 'two springs 3,000km apart are not one spring');
  assert.equal(Object.keys(registry).length, 2);

  // Assert the refs, not merely the count: a count alone would pass against
  // any other bug that happened to split them.
  for (const [id, entry] of Object.entries(registry)) {
    assert.deepEqual(entry.osmRefs, [], `${id} must contribute no OSM ref at all`);
  }
  assert.equal(registry[alphaId].name, 'Alpha');
  assert.equal(registry[omegaId].name, 'Omega');
  assert.deepEqual(registry[alphaId].centroid, [-110.5, 44.6], "Alpha's centroid must not be overwritten");
});

test('a refless registry entry does not merge with a named OSM way 44m away', () => {
  // This has to run through resolveRegistry. The defect lives in
  // asComparable, which rendered a refless entry as 'osm-node-0', so a test
  // that hands isSameSpring two hand-built objects passes while the bug is
  // fully live.
  const reflessRegistry = () => ({
    whs_refless: {
      osmRefs: [],
      centroid: [-21.2222, 64.048],
      name: null,
      firstSeen: '2026-01-01',
      lastSeen: '2026-01-01',
      missingSince: null,
    },
  });
  // 0.0004 degrees of latitude is ~44m: past ANONYMOUS_METERS, inside
  // SAME_FEATURE_METERS -- the radius where the named/unnamed branch decides.
  const at44m = (id) => ({
    id,
    name: 'Emerald Pool',
    location: { lat: 64.0484, lng: -21.2222 },
    sources: [`https://www.openstreetmap.org/${osmRefOf(id)}`],
  });

  // Measured against the unfixed code: the way MERGED (a fabricated 'node'
  // beside a 'way' looks exactly like source-and-pool) while the node stayed
  // separate. Both must now stay separate, because the entry's feature kind
  // is unknown, and unknown is not evidence.
  const way = resolveRegistry([at44m('osm-way-2')], reflessRegistry(), '2026-09-03');
  assert.notEqual(way.assignments.get('osm-way-2'), 'whs_refless', 'unknown kind must not merge as source-and-pool');
  assert.deepEqual(way.registry.whs_refless.osmRefs, [], 'the refless entry must not adopt the way');
  assert.equal(way.registry.whs_refless.name, null, "and must not take the way's name");

  const node = resolveRegistry([at44m('osm-node-3')], reflessRegistry(), '2026-09-03');
  assert.notEqual(node.assignments.get('osm-node-3'), 'whs_refless', 'unchanged: this never merged');

  // The branch really is reached at this distance: give the same entry a real
  // OSM node ref and the source-and-pool merge still happens. Without this,
  // the two assertions above would also pass if the fallback never ran.
  const withRef = { whs_refless: { ...reflessRegistry().whs_refless, osmRefs: ['node/7'] } };
  const merged = resolveRegistry([at44m('osm-way-2')], withRef, '2026-09-03');
  assert.equal(
    merged.assignments.get('osm-way-2'),
    'whs_refless',
    'a known node and a named way 44m apart still merge -- the fix must not touch entries that have a kind',
  );
});

test('for OSM-shaped ids the named/unnamed branch is bit-identical to the element-type test it replaced', () => {
  // dedupe() in build-dataset.mjs is the matcher's second caller and merges
  // 1,167 records per build. Every record it sees carries normalizeElement's
  // `osm-<type>-<id>`, so pinning equivalence across that whole input space
  // is what proves the published build cannot move.
  const legacy = (a, b) =>
    distanceMeters(a.location, b.location) <= SAME_FEATURE_METERS && a.id.split('-')[1] !== b.id.split('-')[1];

  let compared = 0;
  let merges = 0;
  for (const ta of ['node', 'way', 'relation']) {
    for (const tb of ['node', 'way', 'relation']) {
      for (const dLat of [0, 0.0004, 0.0006]) {
        for (const [na, nb] of [['Reykjadalur', null], [null, 'Reykjadalur']]) {
          const a = { id: `osm-${ta}-1`, name: na, location: { lat: 64.048, lng: -21.2222 } };
          const b = { id: `osm-${tb}-2`, name: nb, location: { lat: 64.048 + dLat, lng: -21.2222 } };
          const got = isSameSpring(a, b);
          assert.equal(got, legacy(a, b), `${ta}/${tb} at ${dLat} deg`);
          compared++;
          if (got) merges++;
        }
      }
    }
  }
  assert.equal(compared, 54, 'every element-type pair, at three distances, in both name orders');
  assert.ok(merges > 0, 'a set of cases that never merges would make the equivalence vacuous');
});

test('every id the build feeds the matcher is OSM-shaped, so that equivalence covers it', () => {
  // The equivalence only proves the build is unchanged if nothing reaching
  // dedupe has an unknown kind. normalizeElement is the sole producer of the
  // ids dedupe sees.
  for (const type of ['node', 'way', 'relation']) {
    const el = { type, id: 123, lat: 64.048, lon: -21.2222, tags: { natural: 'hot_spring', name: 'X' } };
    const lookup = () => ({ iso: 'IS', name: 'Iceland', exact: true });
    const { record } = normalizeElement(el, lookup, '2026-09-03');
    assert.equal(osmType(record.id), type, 'a record with an unknown kind would change what dedupe merges');
  }
});
