/**
 * Tests for the parsing rules that decide what ends up in the dataset.
 * Run with: node --test scripts/
 *
 * These cover the cases that would silently corrupt records if they regressed:
 * unit confusion, qualitative values, and the privacy filter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTemperature, parseAccess, parseClothing, parseType, normalizeElement } from './lib/normalize.mjs';
import { isExcluded } from './lib/exclusions.mjs';

test('temperature: plain numbers and unit suffixes', () => {
  assert.equal(parseTemperature('45').celsius, 45);
  assert.equal(parseTemperature('45 C').celsius, 45);
  assert.equal(parseTemperature('45°C').celsius, 45);
  assert.equal(parseTemperature('38 °C').celsius, 38);
  assert.equal(parseTemperature('~42').celsius, 42);
  assert.equal(parseTemperature('40,5').celsius, 40.5);
});

test('temperature: fahrenheit converts to celsius', () => {
  assert.equal(parseTemperature('113 F').celsius, 45);
  assert.equal(parseTemperature('104 fahrenheit').celsius, 40);
});

test('temperature: ranges collapse to the midpoint and keep the original', () => {
  const r = parseTemperature('40-45');
  assert.equal(r.celsius, 42.5);
  assert.match(r.note, /40-45/);
});

test('temperature: qualitative values yield no number but are preserved', () => {
  const r = parseTemperature('hot');
  assert.equal(r.celsius, null, 'must not invent a number');
  assert.equal(r.qualitative, 'hot');
});

test('temperature: implausible readings are rejected, not stored', () => {
  // A mis-tag, most likely kelvin or a sentinel. Better Unknown than wrong.
  assert.equal(parseTemperature('318').celsius, null);
  assert.equal(parseTemperature('-40').celsius, null);
  assert.equal(parseTemperature('').celsius, null);
  assert.equal(parseTemperature(undefined).celsius, null);
});

test('price: fee and charge tags', () => {
  assert.equal(parseAccess({ fee: 'no' }).price, 'Free');
  assert.equal(parseAccess({ fee: 'yes' }).price, 'Paid (amount unknown)');
  assert.equal(parseAccess({ charge: '500 JPY' }).price, '500 JPY');
  assert.equal(parseAccess({ charge: '500 JPY' }).currency, 'JPY');
  assert.equal(parseAccess({}).price, null, 'absent fee must be Unknown, not Free');
});

test('clothing: OSM nudism semantics are inverted from the obvious reading', () => {
  assert.equal(parseClothing({ nudism: 'obligatory' }).policy, 'required');
  assert.equal(parseClothing({ nudism: 'customary' }).policy, 'optional');
  assert.equal(parseClothing({ nudism: 'no' }).policy, 'textile-only');
  assert.equal(parseClothing({}).policy, 'unknown');
});

test('type: built infrastructure separates developed from wild', () => {
  assert.equal(parseType({ natural: 'hot_spring' }), 'wild');
  assert.equal(parseType({ natural: 'hot_spring', name: 'Foo Spring' }), 'natural');
  assert.equal(parseType({ natural: 'hot_spring', fee: 'yes' }), 'developed');
  assert.equal(parseType({ amenity: 'public_bath', 'bath:type': 'onsen' }), 'developed');
  assert.equal(parseType({ amenity: 'public_bath', 'bath:type': 'onsen', tourism: 'hotel' }), 'resort');
});

const lookup = () => ({ iso: 'IS', name: 'Iceland', exact: true });

test('normalize: private access is rejected outright', () => {
  const { record, reject } = normalizeElement(
    { type: 'node', id: 1, lat: 64, lon: -21, tags: { natural: 'hot_spring', access: 'private' } },
    lookup,
    '2026-08-24',
  );
  assert.equal(record, null);
  assert.match(reject, /private/);
});

test('normalize: every public record is unicorn:false and unverified', () => {
  const { record } = normalizeElement(
    { type: 'node', id: 2, lat: 64, lon: -21, tags: { natural: 'hot_spring', name: 'Test' } },
    lookup,
    '2026-08-24',
  );
  assert.equal(record.unicorn, false);
  assert.equal(record.verified, false, 'bulk ingest is never human-verified');
  assert.ok(record.sources.length > 0, 'every record must cite a source');
});

test('normalize: a record names the provider it came from, as a list', () => {
  // The normaliser is where provenance enters the dataset, so a regression to
  // a bare string starts here and is only visible in the published file after
  // a rebuild. `['osm']` is the whole truth for an OSM element and still has
  // to be a list: the next source will contribute records assembled from two
  // providers, and a single value cannot say so.
  const { record } = normalizeElement(
    { type: 'node', id: 4, lat: 64, lon: -21, tags: { natural: 'hot_spring', name: 'Test' } },
    lookup,
    '2026-08-24',
  );
  assert.ok(Array.isArray(record.quality.provenance), 'provenance must be a list');
  assert.deepEqual(record.quality.provenance, ['osm']);
});

test('normalize: a scalding spring carries a warning', () => {
  const { record } = normalizeElement(
    { type: 'node', id: 3, lat: 64, lon: -21, tags: { natural: 'hot_spring', temperature: '62' } },
    lookup,
    '2026-08-24',
  );
  assert.ok(record.warnings.some((w) => /scald/i.test(w)));
});

test('privacy: exclusion by radius survives a change of OSM id', () => {
  const exclusions = { entries: [{ lat: 64.0, lng: -21.0, radiusMeters: 2000 }] };
  const near = { id: 'osm-node-999', name: null, location: { lat: 64.005, lng: -21.0 } };
  const far = { id: 'osm-node-998', name: null, location: { lat: 65.0, lng: -21.0 } };
  assert.equal(isExcluded(near, exclusions), true, 'a re-mapped spring must stay excluded');
  assert.equal(isExcluded(far, exclusions), false);
});

test('privacy: exclusion by osm id', () => {
  const exclusions = { entries: [{ osmId: 'node/123' }] };
  assert.equal(isExcluded({ id: 'osm-node-123', location: { lat: 0, lng: 0 } }, exclusions), true);
  assert.equal(isExcluded({ id: 'osm-node-124', location: { lat: 0, lng: 0 } }, exclusions), false);
});
