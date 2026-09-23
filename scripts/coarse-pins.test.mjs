import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCoarseDuplicates, identityName, COARSE_PIN_METERS } from './lib/coarse-pins.mjs';

// ~111 m per 0.001 degree of latitude.
const at = (dm) => ({ lat: 45 + dm / 111_000, lng: -120 });
const pin = (name, m, key = name) => ({
  name,
  location: at(m),
  quality: { provenance: ['ncei'] },
  sourceRefs: [{ provider: 'ncei', externalId: key }],
});
const osm = (name, m = 0) => ({ name, location: at(m), quality: { provenance: ['osm'] } });

const names = ({ bound }) => bound.map((b) => `${b.pin.name} -> ${b.into.name}`);

test('identityName drops only the words the two sources disagree about', () => {
  assert.equal(identityName('UMPQUA HOT SPRINGS'), identityName('Umpqua Hot Springs'));
  assert.equal(identityName('MICKEY SPRINGS'), identityName('Mickey Hot Springs'));
  assert.equal(identityName('NIMROD SPRINGS'), identityName('Nimrod Warm Springs'));
  assert.equal(identityName('DRAKESBAD'), identityName('Drakesbad Hot Springs'));
  assert.notEqual(identityName('Blue Joint Hot Springs 2'), identityName('Blue Joint Hot Springs'));
  assert.notEqual(identityName('GLENWOOD SPRINGS'), identityName('Glenwood Hot Springs Therapy Pool'));
  assert.equal(identityName('HOT SPRING'), '', 'a generic name identifies nothing');
});

test('a coarse pin binds to the one same-named record within range', () => {
  const r = findCoarseDuplicates([pin('UMPQUA HOT SPRINGS', 400), osm('Umpqua Hot Springs')]);
  assert.deepEqual(names(r), ['UMPQUA HOT SPRINGS -> Umpqua Hot Springs']);
  assert.ok(Math.abs(r.bound[0].meters - 400) <= 2, String(r.bound[0].meters));
});

test('nothing binds past the measured radius', () => {
  const r = findCoarseDuplicates([pin('Umpqua', COARSE_PIN_METERS + 50), osm('Umpqua')]);
  assert.deepEqual(r.bound, []);
});

test('a name that only contains the other is not the same spring', () => {
  const r = findCoarseDuplicates([pin('BLUE JOINT HOT SPRINGS 2', 300), osm('Blue Joint Hot Springs')]);
  assert.deepEqual(r.bound, []);
});

test('a generic or too-short name never binds, however close', () => {
  const r = findCoarseDuplicates([pin('HOT SPRING', 10), osm('Hot Spring'), pin('AB', 10), osm('Ab')]);
  assert.deepEqual(r.bound, []);
});

test('two candidates for one pin is a refusal, not a tie-break', () => {
  const r = findCoarseDuplicates([pin('Baker', 100), osm('Baker Hot Springs', 0), osm('Baker Spring', 600)]);
  assert.deepEqual(r.bound, []);
  assert.match(r.refused[0].reason, /two records/);
});

test('two pins wanting one record both refuse', () => {
  const r = findCoarseDuplicates([pin('Geyser Ranch', 300, 'a'), pin('GEYSER RANCH', 900, 'b'), osm('Geyser Ranch Springs')]);
  assert.deepEqual(r.bound, []);
  assert.equal(r.refused.length, 2);
  assert.ok(r.refused.every((x) => /two NOAA pins/.test(x.reason)));
});

test('a pin never binds to another pin, and a merged record is not a pin', () => {
  const r = findCoarseDuplicates([pin('Olympic', 0, 'a'), pin('Olympic', 500, 'b')]);
  assert.deepEqual(r.bound, [], 'two NOAA rows are NOAA listing two things');
  const corroborated = { ...osm('Paulina Hot Springs', 0), quality: { provenance: ['ncei', 'osm'] } };
  assert.deepEqual(names(findCoarseDuplicates([pin('PAULINA SPRINGS', 500), corroborated])), [
    'PAULINA SPRINGS -> Paulina Hot Springs',
  ]);
});
