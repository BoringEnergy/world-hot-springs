import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isExcluded } from './lib/exclusions.mjs';
import { distanceMeters } from './lib/geo.mjs';

const SOURCE = fs.readFileSync('scripts/build-dataset.mjs', 'utf8');

test('the privacy filter is the last stage that can remove or move a record', () => {
  const privacyAt = SOURCE.indexOf('isExcluded(');
  const dedupeAt = SOURCE.indexOf('dedupe(records)');
  assert.ok(privacyAt > 0 && dedupeAt > 0, 'both stages must exist');
  assert.ok(
    dedupeAt < privacyAt,
    'dedupe must run BEFORE the privacy filter. mergeInto() adopts the winner ' +
      'coordinates, so a merge after the check can move a record into an ' +
      'exclusion radius that has already been cleared.',
  );
});

test('a merged record is re-checked at its post-merge position', () => {
  // The concrete hazard the ordering exists to prevent. A record sits outside
  // an exclusion radius on its own, passes the filter, and is then pulled
  // inside it by a merge that adopts the winner's coordinates.
  const exclusions = { entries: [{ lat: 64.0, lng: -21.0, radiusMeters: 500 }] };
  const beforeMerge = { id: 'osm-node-1', name: 'X', location: { lat: 64.01, lng: -21.0 } };
  const afterMerge = { id: 'osm-node-1', name: 'X', location: { lat: 64.002, lng: -21.0 } };

  assert.ok(
    distanceMeters(beforeMerge.location, { lat: 64.0, lng: -21.0 }) > 500,
    'the pre-merge position must genuinely sit outside the radius',
  );
  assert.equal(isExcluded(beforeMerge, exclusions), false);
  assert.equal(
    isExcluded(afterMerge, exclusions),
    true,
    'the post-merge position is inside the radius, so stage order decides ' +
      'whether this spring is published',
  );
});

test('nothing that can add, move, or reintroduce a record runs after the privacy filter', () => {
  // Guards against a future stage being appended below the filter. The filter
  // is the project's central guarantee; anything after it is unchecked.
  const privacyAt = SOURCE.indexOf('isExcluded(');
  const tail = SOURCE.slice(privacyAt);
  for (const forbidden of ['dedupe(', 'mergeInto(', 'normalizeElement(']) {
    assert.ok(
      !tail.includes(forbidden),
      `${forbidden} appears after the privacy filter; it can change what is published`,
    );
  }
});

test('the unicorn invariant is asserted before anything is written', () => {
  const leakAt = SOURCE.indexOf("r.unicorn !== false");
  const writeAt = SOURCE.indexOf('fs.writeFileSync(OUT_JSON');
  assert.ok(leakAt > 0 && writeAt > 0);
  assert.ok(leakAt < writeAt, 'the unicorn check must gate the write, not follow it');
});

import { applyOverlays } from './lib/overlay.mjs';
import { resolveRegistry, OSM_PROVIDER } from './lib/identity.mjs';

test('the build wires identity and overlay between dedupe and the privacy filter', () => {
  const dedupeAt = SOURCE.indexOf('dedupe(records)');
  const identityAt = SOURCE.indexOf('resolveRegistry(');
  const overlayAt = SOURCE.indexOf('applyOverlays(');
  const privacyAt = SOURCE.indexOf('isExcluded(');

  assert.ok(identityAt > dedupeAt, 'identity resolves after dedupe, on final records');
  assert.ok(overlayAt > identityAt, 'claims are keyed by whs_ id, so identity must run first');
  assert.ok(privacyAt > overlayAt, 'the privacy filter still runs last');
});

test('an orphaned claim fails the build rather than being silently dropped', () => {
  assert.match(
    SOURCE,
    /orphaned[\s\S]{0,400}process\.exit\(1\)/,
    'a claim with nowhere to land is a lost correction and must be fatal',
  );
});

test('a claim suppressed by the privacy filter is reported without leaking detail', () => {
  const suppressedAt = SOURCE.indexOf('suppressed');
  const privacyAt = SOURCE.indexOf('isExcluded(');
  assert.ok(suppressedAt > privacyAt, 'accounting must run after the filter to see what survived');
  const block = SOURCE.slice(suppressedAt, suppressedAt + 600);
  assert.ok(!/claim\.value|claims\[/.test(block), 'must not log claim contents');
});

test('the shipped dataset uses durable ids', () => {
  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  assert.ok(springs.length > 6000, `expected the full dataset, got ${springs.length}`);
  for (const s of springs) {
    assert.match(s.id, /^whs_[0-9a-f]{12}$/, `${s.id} is not a durable id`);
    assert.ok(Array.isArray(s.osmRefs) && s.osmRefs.length > 0, `${s.id} has no OSM refs`);
  }
});

test('every shipped id is unique', () => {
  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  assert.equal(new Set(springs.map((s) => s.id)).size, springs.length);
});

test('the registry covers every shipped spring', () => {
  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const registry = JSON.parse(fs.readFileSync('data/registry.json', 'utf8'));
  for (const s of springs) {
    assert.ok(registry[s.id], `${s.id} is published but absent from the registry`);
  }
});

test('end to end: a claim survives a rebuild and an upstream redraw', () => {
  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const target = springs.find((s) => s.temperature.celsius === null && s.name);
  assert.ok(target, 'need a spring with no recorded temperature');

  const overlays = new Map([[
    target.id,
    {
      id: target.id,
      claims: {
        'temperature.celsius': {
          value: 38, source: 'https://example.org/survey', measuredAt: '2026-03-14',
          contributor: 'github:tester', state: 'active',
        },
      },
    },
  ]]);

  // Build 1: the claim lands.
  const first = applyOverlays(structuredClone(springs), overlays);
  assert.equal(first.records.find((s) => s.id === target.id).temperature.celsius, 38);

  // Build 2: upstream is re-ingested and still knows nothing. The claim holds.
  const second = applyOverlays(structuredClone(springs), overlays);
  assert.equal(second.records.find((s) => s.id === target.id).temperature.celsius, 38);

  // Build 3: OSM deletes the node and redraws the spring under a brand new id.
  // The registry resolves it to the same durable id, so the claim still lands.
  const registry = JSON.parse(fs.readFileSync('data/registry.json', 'utf8'));
  const redrawn = {
    ...structuredClone(target),
    id: 'osm-node-999999999',
    sources: ['https://www.openstreetmap.org/node/999999999'],
  };
  const resolved = resolveRegistry([redrawn], registry, '2026-12-01');
  assert.equal(
    resolved.assignments.get('osm-node-999999999'),
    target.id,
    'a redraw under a new OSM id must not orphan the claim',
  );

  const third = applyOverlays(
    [{ ...redrawn, id: resolved.assignments.get('osm-node-999999999') }],
    overlays,
  );
  assert.equal(
    third.records[0].temperature.celsius,
    38,
    'the claim reattaches to the redrawn spring',
  );
});

test('land-manager restrictions run after the overlay and before the privacy filter', () => {
  // Ordering is the safety property, not a style choice. After the overlay,
  // no authored claim can weaken an agency prohibition. Before the privacy
  // filter, because the stage only edits fields on records that already
  // exist — it never adds, moves or removes one.
  const overlayAt = SOURCE.indexOf('applyOverlays(');
  const landAt = SOURCE.indexOf('applyLandManagers(');
  const privacyAt = SOURCE.indexOf('isExcluded(');
  assert.ok(landAt > 0, 'the land-manager stage must be wired into the build');
  assert.ok(landAt > overlayAt, 'an overlay claim must not be able to override a land manager');
  assert.ok(privacyAt > landAt, 'the privacy filter still runs last');
});

test('the land-manager stage cannot silently no-op when its list is missing', () => {
  // loadLandManagers throws rather than returning []. The build has no catch
  // around it, so a missing or malformed list fails the build instead of
  // publishing every restricted spring unwarned.
  assert.match(SOURCE, /loadLandManagers\(\)/);
  const at = SOURCE.indexOf('loadLandManagers()');
  const block = SOURCE.slice(at - 400, at + 400);
  assert.ok(!/try\s*\{/.test(block), 'a swallowed load failure would publish restricted springs');
});

import { mergeInto } from './build-dataset.mjs';

test('every shipped record names the providers it was built from', () => {
  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  assert.ok(springs.length > 6000, `expected the full dataset, got ${springs.length}`);
  for (const s of springs) {
    // A record with no provenance has nothing vouching for it, and a bare
    // string cannot describe a record two providers contributed to. Assert the
    // value, not merely that the field is populated: "provenance is present"
    // was true of the single literal this list replaced.
    assert.ok(Array.isArray(s.quality.provenance), `${s.id} provenance is not an array`);
    assert.ok(s.quality.provenance.length > 0, `${s.id} claims no provenance at all`);
    assert.deepEqual(
      s.quality.provenance,
      ['osm'],
      `${s.id} names a provider no normaliser in this build can produce`,
    );
  }
});

/** The fields mergeInto reads or writes, and nothing else. */
function mergeable(provenance, over = {}) {
  return {
    name: null,
    description: null,
    sources: [],
    warnings: [],
    tags: [],
    temperature: { celsius: null, fahrenheit: null, source: null, measuredAt: null, qualitative: null },
    access: { price: null, currency: null, notes: null, status: 'unknown', bathingAllowed: null },
    clothing: { policy: 'unknown', schedule: null, notes: null },
    hours: { open: null, seasonalNotes: null, status: 'unknown' },
    type: 'unknown',
    location: { lat: 0, lng: 0, elevation: null, region: null, nearestTown: null },
    quality: { provenance, completeness: 0, known: [], ingestedAt: '2026-01-01' },
    ...over,
  };
}

test('a merge unions provenance rather than keeping only the winner\'s', () => {
  // The whole point of mergeInto is that the loser's knowledge survives in the
  // winner. Its provenance is part of that knowledge: a record that kept the
  // evidence but dropped the provider naming it would be citing a source it no
  // longer admits to using.
  const winner = mergeable(['osm']);
  mergeInto(winner, mergeable(['usgs']));
  assert.deepEqual(winner.quality.provenance, ['osm', 'usgs']);
});

test('provenance union is order-independent, so either record may win', () => {
  // dedupe picks the winner by completeness, which is a property of the data
  // and not of the providers. The merged record must be the same either way,
  // or the published provenance would depend on which record happened to be
  // more complete on the day.
  const a = mergeable(['usgs']);
  mergeInto(a, mergeable(['osm']));
  const b = mergeable(['osm']);
  mergeInto(b, mergeable(['usgs']));
  assert.deepEqual(a.quality.provenance, b.quality.provenance);
  assert.deepEqual(a.quality.provenance, ['osm', 'usgs']);
});

test('merging two records from one provider does not name it twice', () => {
  // Every one of today's 1,167 merges is this case. A concatenating union
  // would publish ["osm","osm"] on all of them and grow by one entry per
  // merge for any spring mapped three times.
  const winner = mergeable(['osm']);
  mergeInto(winner, mergeable(['osm']));
  assert.deepEqual(winner.quality.provenance, ['osm']);
});

test('the published schema declares provenance as a list, over one vocabulary', () => {
  // Two things nothing else can catch. `tsc` is silent on both: no code in
  // src/ reads quality.provenance, so narrowing the field back to a single
  // literal typechecks, and the .mjs half of the pipeline is untyped, so a
  // provider spelled one way in identity.mjs and another in types.ts compiles
  // cleanly and diverges forever.
  const types = fs.readFileSync('src/lib/types.ts', 'utf8');
  assert.match(
    types,
    /^\s*provenance: SourceProvider\[\];$/m,
    'a single value cannot describe a record two providers contributed to',
  );
  const decl = /export type SourceProvider = (.+);/.exec(types);
  assert.ok(decl, 'SourceProvider must be declared, not inlined');
  const declared = decl[1].split('|').map((v) => v.trim().replace(/^'|'$/g, ''));
  assert.ok(
    declared.includes(OSM_PROVIDER),
    `SourceProvider omits "${OSM_PROVIDER}", the provider identity.mjs mints and stores`,
  );
});

test('the build cannot become a silent no-op when imported or on an old runtime', () => {
  // main() is guarded so that importing this module for mergeInto does not
  // rebuild the dataset. The guard is the hazard: `undefined` is falsy, so a
  // runtime without import.meta.main would turn `npm run data:build` into a
  // command that prints nothing, exits 0, and leaves the previous dataset in
  // place. The build must fail loudly instead.
  // Anchored to the start of a line: an unanchored match is satisfied by the
  // call commented out, which is the mutation this assertion exists to catch.
  const call = /^if \(import\.meta\.main\) main\(\);$/m;
  assert.match(SOURCE, call, 'the entry point must still run');
  const guardAt = SOURCE.indexOf("typeof import.meta.main !== 'boolean'");
  assert.ok(guardAt > 0, 'the guard must be checked, not assumed');
  assert.ok(
    guardAt < call.exec(SOURCE).index,
    'the capability check has to precede the call it decides',
  );
});
