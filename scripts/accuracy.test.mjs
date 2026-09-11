/**
 * Pin accuracy: who placed the point, not who enriched it.
 *
 * Every test here guards a way this could be filled wrong, and three of them
 * describe mistakes that were specifically warned against before the code
 * existed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { accuracyMetersOf, reconcileAccuracy, NCEI_ACCURACY_M } from './lib/accuracy.mjs';

const rec = (over = {}) => ({ osmRefs: [], sourceRefs: [], location: { accuracyMeters: null }, ...over });

test('an OSM pin states nothing, and no figure is invented for it', () => {
  // "A node is about 5-10 m" is a measurement nobody made. Null is the
  // honest answer for a point whose precision the source never stated.
  assert.equal(accuracyMetersOf(rec({ osmRefs: ['node/1'] })), null);
  assert.equal(accuracyMetersOf(rec()), null, 'no refs at all is still not a figure');
});

test('an NCEI-minted pin states 110 m', () => {
  assert.equal(
    accuracyMetersOf(rec({ sourceRefs: [{ provider: 'ncei', externalId: 'NV/39.5/-118.8' }] })),
    NCEI_ACCURACY_M,
  );
  assert.equal(NCEI_ACCURACY_M, 110, "ncei-admit's own floor is 3 dp, which it calls ~110 m");
});

test('a record NOAA merely confirmed keeps its OSM silence', () => {
  // The trap this was warned about. 131 shipped records carry ncei
  // provenance while sitting on an OSM node -- springs NOAA corroborated
  // rather than placed. Keying off provenance would stamp all of them.
  const confirmed = rec({
    osmRefs: ['node/42'],
    sourceRefs: [{ provider: 'ncei', externalId: 'x' }],
  });
  assert.equal(accuracyMetersOf(confirmed), null);
});

test('a merged pin follows the coordinate that survived', () => {
  // dedupe can merge an admitted NCEI pin into an OSM record, and mergeInto
  // adopts the winner's coordinates. Six shipped records are in that state.
  // Stamped at mint time the 110 would outlive the point it described.
  const merged = rec({ osmRefs: ['way/9'], sourceRefs: [{ provider: 'ncei', externalId: 'x' }] });
  assert.equal(accuracyMetersOf(merged), null);
});

test('an enriching upstream never places a pin', () => {
  // AIST publishes a 190 m cell it fuzzed on purpose, and this atlas uses it
  // as a match key only. Stamping 190 on a Japanese OSM record would
  // attribute the publisher's fuzzing to a point OSM placed precisely.
  // WQP and NBMG are enrichment-only for the same reason.
  for (const provider of ['aist', 'wqp', 'nbmg']) {
    assert.equal(
      accuracyMetersOf(rec({ osmRefs: ['node/7'], sourceRefs: [{ provider, externalId: 'x' }] })),
      null,
      provider,
    );
    // And even with no OSM ref, none of them mints a coordinate.
    assert.equal(accuracyMetersOf(rec({ sourceRefs: [{ provider, externalId: 'x' }] })), null, provider);
  }
});

test('reconciling reports whether it changed anything', () => {
  // The build prints this count; if it churned every record the number would
  // be noise rather than a report of what it set.
  const fresh = rec({ sourceRefs: [{ provider: 'ncei', externalId: 'x' }] });
  assert.equal(reconcileAccuracy(fresh), true);
  assert.equal(fresh.location.accuracyMeters, 110);
  assert.equal(reconcileAccuracy(fresh), false, 'idempotent');
  // And it CLEARS a stale value, which is what makes late derivation safe.
  const stale = rec({ osmRefs: ['node/1'], location: { accuracyMeters: 110 } });
  assert.equal(reconcileAccuracy(stale), true);
  assert.equal(stale.location.accuracyMeters, null);
});

test('the shipped dataset agrees with the rule', () => {
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const wrong = all.filter((s) => s.location.accuracyMeters !== accuracyMetersOf(s));
  assert.deepEqual(wrong.map((s) => s.id), []);

  const stated = all.filter((s) => s.location.accuracyMeters !== null);
  assert.ok(stated.length > 500, 'not vacuous: pins really were minted');
  assert.deepEqual([...new Set(stated.map((s) => s.location.accuracyMeters))], [110]);
  // Not one of them is an OSM point.
  assert.deepEqual(stated.filter((s) => (s.osmRefs ?? []).length).map((s) => s.id), []);

  // The 131, checked as a population rather than by construction.
  const confirmed = all.filter((s) => s.quality.provenance.includes('ncei') && (s.osmRefs ?? []).length);
  assert.ok(confirmed.length > 100, 'not vacuous: NOAA really did corroborate OSM pins');
  assert.deepEqual(confirmed.filter((s) => s.location.accuracyMeters !== null).map((s) => s.id), []);
});

test('accuracy is derived after dedupe and identity, not at mint time', () => {
  const source = fs.readFileSync('scripts/build-dataset.mjs', 'utf8');
  const dedupe = source.indexOf('dedupe(records)');
  const identity = source.indexOf('resolveRegistry(');
  const derive = source.indexOf('reconcileAccuracy(r)');
  const privacy = source.indexOf('isExcluded(');
  assert.ok(derive > 0, 'the build must derive accuracy');
  assert.ok(derive > dedupe, 'a merge can replace the coordinate it describes');
  assert.ok(derive > identity, 'refs must be final first');
  assert.ok(privacy > derive, 'the privacy filter still runs last');
});
