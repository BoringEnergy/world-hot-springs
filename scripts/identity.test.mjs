import test from 'node:test';
import assert from 'node:assert/strict';
import { osmType, osmRefOf, isSameSpring, mintId, mintRef, resolveRegistry } from './lib/identity.mjs';

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

const osmRef = (externalId) => ({ provider: 'osm', externalId });

test('mintId is deterministic and prefixed', () => {
  const a = mintId(osmRef('node/4702109263'));
  assert.match(a, /^whs_[0-9a-f]{12}$/);
  assert.equal(a, mintId(osmRef('node/4702109263')), 'same ref must always mint the same id');
  assert.notEqual(a, mintId(osmRef('node/4702109264')));
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
  const collidingId = mintId(osmRef('node/1'));
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

test('a non-OSM record is refused a durable id rather than given a temporary one', () => {
  // Measured against the unfixed code, these two -- 3,000km apart -- became
  // ONE entry, whs_2098f7a355ba, osmRefs ['undefined/undefined'], named
  // "Omega" at Omega's centroid: Alpha's name and position overwritten, and
  // both records stamped with the same durable id.
  //
  // With refsOf fixed there is no mint input left, and inventing one would
  // mint an id the provider-aware mintId is going to move. An id that moves
  // orphans every overlay file named for it, so the build stops instead.
  const alpha = { id: 'usgs:P96Q13U3', name: 'Alpha', location: { lat: 44.6, lng: -110.5 }, sources: [] };
  const omega = { id: 'usgs:ZZZ999', name: 'Omega', location: { lat: 10.0, lng: 20.0 }, sources: [] };

  for (const record of [alpha, omega]) {
    assert.throws(
      () => resolveRegistry([record], {}, '2026-09-03'),
      (err) => {
        assert.match(err.message, /no source ref/);
        // Naming the record is the difference between a fixable build failure
        // and a hunt through 14k records.
        assert.match(err.message, new RegExp(record.id.replace(':', '\\:')));
        return true;
      },
      `${record.id} must be refused by name`,
    );
  }

  // And the pair together, which is the shape the defect was measured in:
  // it must fail rather than quietly resolve both onto one entry.
  assert.throws(() => resolveRegistry([alpha, omega], {}, '2026-09-03'), /no source ref/);
});

test('a non-OSM record contributes no ref to an entry it does match', () => {
  // The Critical-1 fix on its own, observed where minting is not in the way:
  // the record resolves by position and name, so it gets an id -- and the
  // entry must come out holding exactly the refs it started with. Against the
  // unfixed code the entry also adopts 'undefined/undefined', which is the
  // key every other non-OSM record would then resolve onto.
  const registry = {
    whs_known: {
      osmRefs: ['node/7'],
      centroid: [-110.5, 44.6],
      name: 'Alpha',
      firstSeen: '2026-01-01',
      lastSeen: '2026-01-01',
      missingSince: null,
    },
  };
  const usgs = { id: 'usgs:P96Q13U3', name: 'Alpha', location: { lat: 44.6, lng: -110.5 }, sources: [] };
  const { registry: after, assignments } = resolveRegistry([usgs], registry, '2026-09-03');

  assert.equal(assignments.get('usgs:P96Q13U3'), 'whs_known', 'an identical name at the same point is the same spring');
  assert.deepEqual(after.whs_known.osmRefs, ['node/7'], 'a non-OSM id must contribute no ref, synthesised or otherwise');
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

// --- source-independent identity: sourceRefs on the registry ---
// Migration steps 1 and 2 of the design note. The registry gains sourceRefs as
// the thing it matches on; osmRefs stays, derived. Minting is untouched.

import fs from 'node:fs';
import { loadRegistry, OSM_PROVIDER } from './lib/identity.mjs';

const legacyEntry = (osmRefs) => ({
  osmRefs,
  centroid: [-21.2222, 64.048],
  name: 'Reykjadalur',
  firstSeen: '2026-01-01',
  lastSeen: '2026-01-01',
  missingSince: null,
});

test('an entry holding only osmRefs -- the shape all 6,471 committed entries have -- gains synthesised sourceRefs', () => {
  // Asserting the value, not merely that it loaded: an implementation that
  // synthesised nothing, or synthesised the wrong provider, would still let
  // every existing entry through the resolver.
  const loaded = loadRegistry({ whs_a: legacyEntry(['node/1', 'way/55']) });
  assert.deepEqual(loaded.whs_a.sourceRefs, [
    { provider: 'osm', externalId: 'node/1' },
    { provider: 'osm', externalId: 'way/55' },
  ]);
  assert.deepEqual(loaded.whs_a.osmRefs, ['node/1', 'way/55'], 'the projection is unchanged by loading');

  // ...and it still resolves: the record matches by ref, mints nothing, and
  // lands on the same entry.
  const { assignments, registry, events } = resolveRegistry(
    [rec('osm-node-1', 64.048, -21.2222, 'Reykjadalur')],
    { whs_a: legacyEntry(['node/1', 'way/55']) },
    '2026-09-03',
  );
  assert.equal(assignments.get('osm-node-1'), 'whs_a');
  assert.deepEqual(events, [], 'a legacy entry that matches is neither new nor gone');
  assert.deepEqual(registry.whs_a.sourceRefs, [
    { provider: 'osm', externalId: 'node/1' },
    { provider: 'osm', externalId: 'way/55' },
  ]);
});

test('osmRefs on a loaded entry is the OSM subset of sourceRefs, and only that', () => {
  // The authored-sourceRefs shape the next build writes, with a non-OSM ref
  // in it. osmRefs must drop the USGS ref and keep the others in order.
  const loaded = loadRegistry({
    whs_a: {
      ...legacyEntry(['this value is overwritten by the projection']),
      sourceRefs: [
        { provider: 'usgs', externalId: 'P96Q13U3' },
        { provider: OSM_PROVIDER, externalId: 'node/1' },
        { provider: OSM_PROVIDER, externalId: 'way/55' },
      ],
    },
  });
  assert.deepEqual(loaded.whs_a.osmRefs, ['node/1', 'way/55']);
  assert.deepEqual(
    loaded.whs_a.osmRefs,
    loaded.whs_a.sourceRefs.filter((r) => r.provider === 'osm').map((r) => r.externalId),
    'osmRefs is derived, never authored',
  );
});

test('a registry sourceRef carries provider and externalId and nothing else', () => {
  // Provenance metadata -- url, license, retrievedAt -- belongs on the record
  // beside the fact it justifies. A copy here would be a second place for it
  // to drift.
  const loaded = loadRegistry({
    whs_a: {
      ...legacyEntry([]),
      sourceRefs: [
        {
          provider: OSM_PROVIDER,
          externalId: 'node/1',
          url: 'https://www.openstreetmap.org/node/1',
          license: 'ODbL-1.0',
          retrievedAt: '2026-09-03',
        },
      ],
    },
  });
  assert.deepEqual(Object.keys(loaded.whs_a.sourceRefs[0]).sort(), ['externalId', 'provider']);
});

test('the build writes sourceRefs, and osmRefs stays its projection through a merge', () => {
  // Step 2: a fresh mint, then a second build that adds a ref. Both paths
  // must leave the two in agreement -- the merge path is the one that used to
  // write osmRefs directly.
  const first = resolveRegistry([rec('osm-node-1', 64.048, -21.2222, 'Reykjadalur')], {}, '2026-08-25');
  const id = first.assignments.get('osm-node-1');
  assert.deepEqual(first.registry[id].sourceRefs, [{ provider: 'osm', externalId: 'node/1' }]);
  assert.deepEqual(first.registry[id].osmRefs, ['node/1']);

  const redrawn = {
    id: 'osm-way-99',
    name: 'Reykjadalur',
    location: { lat: 64.048, lng: -21.2222 },
    sources: ['https://www.openstreetmap.org/node/1'],
  };
  const second = resolveRegistry([redrawn], first.registry, '2026-09-01');
  assert.equal(second.assignments.get('osm-way-99'), id);
  assert.deepEqual(second.registry[id].sourceRefs, [
    { provider: 'osm', externalId: 'node/1' },
    { provider: 'osm', externalId: 'way/99' },
  ]);
  assert.deepEqual(
    second.registry[id].osmRefs,
    second.registry[id].sourceRefs.map((r) => r.externalId),
    'the merge path derives osmRefs too',
  );

  // Sorted, not insertion-ordered. refsOf yields the record's own ref first,
  // so a way that cites a node arrives way-first; the pre-sourceRefs code
  // sorted, and registry.json on disk is sorted because of it.
  const wayFirst = resolveRegistry(
    [
      {
        id: 'osm-way-99',
        name: 'Reykjadalur',
        location: { lat: 64.048, lng: -21.2222 },
        sources: ['https://www.openstreetmap.org/node/1'],
      },
    ],
    {},
    '2026-09-03',
  );
  const fresh = wayFirst.registry[wayFirst.assignments.get('osm-way-99')];
  assert.deepEqual(fresh.osmRefs, ['node/1', 'way/99']);
  assert.deepEqual(fresh.sourceRefs, [
    { provider: 'osm', externalId: 'node/1' },
    { provider: 'osm', externalId: 'way/99' },
  ]);
});

test('a registry entry round-trips through disk unchanged', () => {
  // Load, write, load again. If the reader and the writer disagree about the
  // shape, the second load moves refs -- and a moving ref is a moving id.
  const once = loadRegistry({ whs_a: legacyEntry(['node/1', 'way/55']) });
  const twice = loadRegistry(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);

  const resolved = resolveRegistry([rec('osm-node-1', 64.048, -21.2222, 'Reykjadalur')], once, '2026-09-03');
  const reloaded = loadRegistry(JSON.parse(JSON.stringify(resolved.registry)));
  assert.deepEqual(reloaded, resolved.registry, 'what resolveRegistry writes is what loadRegistry reads back');
});

test('a real id from the committed registry still mints from a bare OSM ref', () => {
  // The permanent compatibility seam. Every whs_ id on disk was hashed from a
  // bare `type/id`; namespacing the input to `osm:node/1078652088` would move
  // all 6,471 of them and orphan every claim filed against them.
  assert.equal(mintId({ provider: 'osm', externalId: 'node/1078652088' }), 'whs_8448a909f48b');

  const committed = JSON.parse(fs.readFileSync('data/registry.json', 'utf8'));
  assert.ok(committed.whs_8448a909f48b, 'the pinned id must still be in the registry');
  assert.ok(
    loadRegistry(committed).whs_8448a909f48b.sourceRefs.some(
      (r) => r.provider === 'osm' && r.externalId === 'node/1078652088',
    ),
    'and the ref it was minted from must survive the load',
  );
});

// --- source-independent identity: the provider-aware mint ---
// Migration step 4. This is the step where an id can move, and a moved id
// orphans every overlay file named for it.

import { createHash } from 'node:crypto';

const sha12 = (input) => `whs_${createHash('sha256').update(input).digest('hex').slice(0, 12)}`;

test('an OSM ref is minted bare and a non-OSM ref is namespaced', () => {
  // Asserting against an independently computed digest, not against mintId
  // itself: `mintId(a) !== mintId(b)` would pass for an implementation that
  // namespaced BOTH sides, which is the failure that moves all 6,471 ids.
  assert.equal(mintId({ provider: 'osm', externalId: 'node/1078652088' }), sha12('node/1078652088'));
  assert.notEqual(mintId({ provider: 'osm', externalId: 'node/1078652088' }), sha12('osm:node/1078652088'));

  assert.equal(mintId({ provider: 'usgs', externalId: 'P96Q13U3' }), sha12('usgs:P96Q13U3'));
  assert.notEqual(mintId({ provider: 'usgs', externalId: 'P96Q13U3' }), sha12('P96Q13U3'));
  assert.equal(mintId({ provider: 'wikidata', externalId: 'Q4115712' }), sha12('wikidata:Q4115712'));
});

test('two providers sharing an externalId mint two different ids', () => {
  const a = mintId({ provider: 'wikidata', externalId: 'Q4115712' });
  const b = mintId({ provider: 'geonames', externalId: 'Q4115712' });
  assert.notEqual(a, b, 'the same string from two inventories is two springs');
  // And neither of them is the bare hash, which is reserved for OSM forever.
  assert.notEqual(a, sha12('Q4115712'));
  assert.notEqual(b, sha12('Q4115712'));
});

test('the byRef index is namespaced, so a shared externalId does not merge two springs', () => {
  // The Critical-1 class of bug, one layer up from mintId. `byRef` used to key
  // on the bare externalId. A registry entry that cites `node/1` from some
  // other inventory and an OSM record whose ref is `node/1` mint DIFFERENT
  // ids -- but on a bare key they collide in the index, so the record resolves
  // onto the existing entry and never reaches minting at all. A test that only
  // exercises mintId passes while that merge happens, so this one goes through
  // resolveRegistry.
  //
  // The two are put 3,000km apart with different names so the positional
  // fallback cannot be what separates them: only the index key can.
  const registry = {
    whs_other: {
      sourceRefs: [{ provider: 'wikidata', externalId: 'node/1' }],
      centroid: [20.0, 10.0],
      name: 'Omega',
      firstSeen: '2026-01-01',
      lastSeen: '2026-01-01',
      missingSince: null,
    },
  };
  const { registry: after, assignments } = resolveRegistry(
    [rec('osm-node-1', 44.6, -110.5, 'Alpha')],
    registry,
    '2026-09-03',
  );

  const minted = assignments.get('osm-node-1');
  assert.notEqual(minted, 'whs_other', 'a wikidata externalId must not capture an OSM ref');
  assert.equal(minted, mintId({ provider: 'osm', externalId: 'node/1' }), 'it must reach minting');
  assert.equal(Object.keys(after).length, 2, 'two providers sharing an externalId are two entries');
  assert.deepEqual(
    after.whs_other.sourceRefs,
    [{ provider: 'wikidata', externalId: 'node/1' }],
    'and the untouched entry must not adopt the OSM ref',
  );
  assert.deepEqual(after[minted].sourceRefs, [{ provider: 'osm', externalId: 'node/1' }]);
});

test('a namespaced index still matches an OSM record onto its own entry', () => {
  // The other half of the test above: namespacing must not stop the ordinary
  // match. Without this, an index keyed on something that never matches would
  // satisfy the assertions above while breaking all 6,471 entries.
  const registry = {
    whs_a: {
      osmRefs: ['node/1'],
      centroid: [20.0, 10.0],
      name: 'Omega',
      firstSeen: '2026-01-01',
      lastSeen: '2026-01-01',
      missingSince: null,
    },
  };
  const { assignments, events } = resolveRegistry([rec('osm-node-1', 44.6, -110.5, 'Alpha')], registry, '2026-09-03');
  assert.equal(assignments.get('osm-node-1'), 'whs_a', 'matched by ref alone, 3,000km from the centroid');
  assert.deepEqual(events, []);
});

test('mintRef prefers the OSM ref, whatever order the refs arrive in', () => {
  // The Jamaica-seed shape: an OSM node that also cites another inventory.
  // Which ref lands at index 0 would otherwise be decided by the order of
  // `record.sources`, which no contract guarantees -- and it decides the id.
  //
  // The companion provider must sort BELOW 'osm', or the lexicographic
  // fallback picks the OSM ref by coincidence and this test passes with the
  // preference deleted. Measured: with 'wikidata' here, removing the
  // preference entirely left this test green.
  const osm = { provider: 'osm', externalId: 'node/1078652088' };
  const gn = { provider: 'geonames', externalId: 'Q4115712' };
  assert.ok(`${gn.provider}:` < `${osm.provider}:`, 'the fallback must not be able to pick OSM on its own');
  assert.deepEqual(mintRef([osm, gn]), osm);
  assert.deepEqual(mintRef([gn, osm]), osm, 'order must not decide the id');
  assert.equal(mintId(mintRef([gn, osm])), 'whs_8448a909f48b', 'and the OSM id it already has is kept');

  // Several non-OSM refs around it, still on both sides of 'osm'.
  const wd = { provider: 'wikidata', externalId: 'Q1' };
  assert.deepEqual(mintRef([wd, gn, osm]), osm);
});

test('with no OSM ref, mintRef takes the lexicographically lowest provider:externalId', () => {
  const usgs = { provider: 'usgs', externalId: 'P96Q13U3' };
  const wd = { provider: 'wikidata', externalId: 'Q4115712' };
  const gn = { provider: 'geonames', externalId: 'ZZZ' };
  // geonames:ZZZ < usgs:P96Q13U3 < wikidata:Q4115712 -- provider first, so the
  // lowest is NOT the one with the lowest externalId. A rule that compared
  // externalIds would pick usgs here.
  for (const order of [
    [usgs, wd, gn],
    [gn, usgs, wd],
    [wd, gn, usgs],
  ]) {
    assert.deepEqual(mintRef(order), gn, 'the key is provider:externalId, and order must not matter');
  }
  assert.deepEqual(mintRef([wd, usgs]), usgs);
  assert.deepEqual(mintRef([usgs, wd]), usgs);
  assert.deepEqual(mintRef([wd]), wd, 'a single ref is its own lowest');
});

test('among several OSM refs, mintRef keeps the ref the id was actually minted from', () => {
  // Measured against the committed registry: 70 of the 738 multi-ref entries
  // were minted from an OSM ref that is not their lexicographically lowest --
  // whs_2e84822fe59f holds ['node/12723737139', 'way/303218726'] and was
  // minted from the WAY. Sorting the OSM refs here would move all 70 on the
  // next bootstrap, so the record's own ref -- first out of refsOf -- wins.
  const wayCitingNode = {
    id: 'osm-way-303218726',
    name: 'Reykjadalur',
    location: { lat: 64.048, lng: -21.2222 },
    sources: ['https://www.openstreetmap.org/node/12723737139'],
  };
  const { assignments, registry } = resolveRegistry([wayCitingNode], {}, '2026-09-03');
  const id = assignments.get('osm-way-303218726');
  assert.equal(id, 'whs_2e84822fe59f', 'the id this pair actually has in the committed registry');
  assert.notEqual(id, mintId({ provider: 'osm', externalId: 'node/12723737139' }), 'not the lower ref');
  // The stored refs are still sorted -- only the mint input reads refsOf order.
  assert.deepEqual(registry[id].osmRefs, ['node/12723737139', 'way/303218726']);

  const committed = JSON.parse(fs.readFileSync('data/registry.json', 'utf8'));
  assert.deepEqual(
    committed.whs_2e84822fe59f.osmRefs,
    ['node/12723737139', 'way/303218726'],
    'the pinned pair must still be on disk in this shape',
  );
});

test('the collision guard prints sourceRefs, which is the only evidence a non-OSM entry has', () => {
  // For an entry with no OSM ref the old message's `existing.osmRefs` is an
  // empty string, so the loudest error in the system loses its evidence
  // exactly when the input space is widest. Asserting the message, not just
  // that it throws: the unfixed code throws here too.
  const collidingId = mintId({ provider: 'osm', externalId: 'node/1' });
  const registry = {
    [collidingId]: {
      sourceRefs: [{ provider: 'usgs', externalId: 'P96Q13U3' }],
      centroid: [10, 20],
      name: 'Some Other Spring',
      firstSeen: '2026-01-01',
      lastSeen: '2026-01-01',
      missingSince: null,
    },
  };
  assert.throws(
    () => resolveRegistry([rec('osm-node-1', 64.048, -21.2222, 'Totally Unrelated Spring')], registry, '2026-08-25'),
    (err) => {
      assert.match(err.message, /collision/i);
      assert.match(err.message, /usgs:P96Q13U3/, 'the existing entry must name its provider and id');
      assert.match(err.message, /osm:node\/1/, 'and so must the incoming ref');
      return true;
    },
  );
});

test('every committed id is still mintable from a ref its entry holds', () => {
  // Named for what it actually checks. An earlier version of this called
  // itself a bootstrap test and was not one: it fed `entry.sourceRefs`, which
  // are stored sorted, whereas a real bootstrap feeds `refsOf(record)`, which
  // puts the record's own ref first. Those differ for exactly the 70 entries
  // discussed at `mintRef`, so the test measured a path the build never takes
  // -- and its own mutation check proved it, staying green when OSM refs were
  // sorted.
  //
  // The invariant below is real and worth pinning: no entry may end up with an
  // id that none of its refs can produce, which is what would make it
  // unreachable on a rebuild from scratch. The ordering rule is guarded by the
  // two tests that follow, which do fail when OSM refs are sorted.
  const registry = JSON.parse(fs.readFileSync('data/registry.json', 'utf8'));
  const unmintable = [];
  for (const [id, entry] of Object.entries(registry)) {
    const refs = entry.sourceRefs ?? [];
    if (!refs.length) continue;
    if (!refs.some((r) => mintId(r) === id)) unmintable.push(id);
  }
  assert.deepEqual(unmintable, [], 'an id no held ref can mint is unreachable from scratch');
});

test('the selection rule does not sort OSM refs', () => {
  // Pinned against a real entry, because this is the case that would move 70.
  const way = { provider: 'osm', externalId: 'way/303218726' };
  const node = { provider: 'osm', externalId: 'node/12723737139' };
  assert.equal(mintId(way), 'whs_2e84822fe59f', 'the committed id came from the way');
  assert.deepEqual(mintRef([way, node]), way, 'first OSM ref wins; sorting would rename it');
});
