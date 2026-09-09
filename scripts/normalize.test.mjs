/**
 * Tests for the parsing rules that decide what ends up in the dataset.
 * Run with: node --test scripts/
 *
 * These cover the cases that would silently corrupt records if they regressed:
 * unit confusion, qualitative values, and the privacy filter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTemperature, parseAccess, parseClothing, parseType, normalizeElement,
  temperatureWarnings, reconcileTemperatureWarnings, deriveWarnings, SCALDING, VERY_HOT,
  completeness,
} from './lib/normalize.mjs';
import fs from 'node:fs';
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

test('temperature: a range takes its UPPER bound and keeps the original', () => {
  // The same convention the contribution rules impose on an authored claim,
  // for the same reason: the error is asymmetric. Understating tells someone a
  // 92C spring is a comfortable 78C. A midpoint is also a number that appears
  // in no source, which is exactly what two retracted claims were retracted
  // for -- the pipeline should not reach it by a route contributors may not.
  const r = parseTemperature('40-45');
  assert.equal(r.celsius, 45);
  assert.match(r.note, /40-45/);
});

test('temperature: the upper bound survives a Fahrenheit range', () => {
  // 104F is 40C. Taking the bound before converting, not after.
  assert.equal(parseTemperature('95-104 F').celsius, 40);
});

test('temperature: a negative reading is still a sign, not a range', () => {
  // The separator canonicaliser is what tells these apart, and taking the
  // upper bound must not turn a below-zero reading into a positive one.
  assert.equal(parseTemperature('-40').celsius, null);
});

test('temperature: an unordered range still yields its maximum', () => {
  // Nothing guarantees a source writes the low end first.
  assert.equal(parseTemperature('45-40').celsius, 45);
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


/**
 * The temperature warnings, and the stage that keeps them true.
 *
 * These exist because a spring shipped at 110C with nothing beside the
 * number. deriveWarnings had run at normalize time, when the record had no
 * temperature; NCEI enrichment and a curated claim both filled one in later
 * and neither could reach the warning. 126 springs at 50C or above were
 * affected, and the count grew with every seeding batch.
 */
test('the temperature warning boundaries are exactly 44 and 50', () => {
  assert.deepEqual(temperatureWarnings(null), []);
  assert.deepEqual(temperatureWarnings(43.9), []);
  assert.deepEqual(temperatureWarnings(44), [VERY_HOT]);
  assert.deepEqual(temperatureWarnings(49.9), [VERY_HOT]);
  assert.deepEqual(temperatureWarnings(50), [SCALDING]);
  assert.deepEqual(temperatureWarnings(110), [SCALDING]);
  // Never both: 50 is scalding, not scalding AND very hot.
  assert.equal(temperatureWarnings(50).length, 1);
});

test('deriveWarnings still emits the temperature warning first', () => {
  // The split must not reorder what normalize already produced. A wild 60C
  // spring leads with the burn, not with the access notice.
  const out = deriveWarnings({}, 60, 'wild');
  assert.equal(out[0], SCALDING);
  assert.ok(out.some((w) => w.startsWith('Undeveloped source')));
});

test('a claim that raises a temperature gains the warning', () => {
  // The defect itself. The record was normalized with no temperature, so it
  // has no warning; the overlay then set 74.
  const r = { temperature: { celsius: 74 }, warnings: [] };
  assert.equal(reconcileTemperatureWarnings(r), true);
  assert.deepEqual(r.warnings, [SCALDING]);
});

test('a claim that lowers a temperature loses the warning', () => {
  // The same failure pointed the other way: a scalding notice about water
  // that is no longer scalding is exactly as wrong as a missing one.
  const r = { temperature: { celsius: 38 }, warnings: [SCALDING, 'Not drinking water.'] };
  assert.equal(reconcileTemperatureWarnings(r), true);
  assert.deepEqual(r.warnings, ['Not drinking water.']);
});

test('reconciling swaps one temperature warning for the other', () => {
  const r = { temperature: { celsius: 46 }, warnings: [SCALDING] };
  reconcileTemperatureWarnings(r);
  assert.deepEqual(r.warnings, [VERY_HOT]);
});

test('reconciling leaves every other warning untouched and in order', () => {
  // The stage owns two strings and nothing else. A contributor's prose, and
  // the order it was written in, must survive.
  const others = ['Undeveloped source: no staff.', 'Mapped hazard: cliff.', 'Not drinking water.'];
  const r = { temperature: { celsius: 55 }, warnings: [...others] };
  reconcileTemperatureWarnings(r);
  assert.deepEqual(r.warnings, [SCALDING, ...others]);
});

test('reconciling an already-correct record reports no change', () => {
  // The build prints this count. If it churned every record the number would
  // be noise rather than a report of what the stage repaired.
  const r = { temperature: { celsius: 55 }, warnings: [SCALDING, 'Not drinking water.'] };
  assert.equal(reconcileTemperatureWarnings(r), false);
  const cold = { temperature: { celsius: 20 }, warnings: [] };
  assert.equal(reconcileTemperatureWarnings(cold), false);
});

test('a record with no temperature carries neither warning', () => {
  const r = { temperature: { celsius: null }, warnings: [SCALDING] };
  reconcileTemperatureWarnings(r);
  assert.deepEqual(r.warnings, []);
});

test('every shipped record agrees with the temperature warning rule', () => {
  // The data half. Tested against the build output rather than constructed
  // records, because the defect was never in deriveWarnings -- it was in
  // nothing calling it again once the temperature arrived.
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const wrong = all.filter((s) => {
    const t = s.temperature.celsius;
    const hasS = s.warnings.includes(SCALDING);
    const hasV = s.warnings.includes(VERY_HOT);
    return hasS !== (t !== null && t >= 50) || hasV !== (t !== null && t >= 44 && t < 50);
  });
  assert.deepEqual(wrong.map((s) => s.id), [], `${wrong.length} record(s) disagree with the rule`);
  // Not vacuous: the dataset really does contain water this hot.
  assert.ok(
    all.filter((s) => s.warnings.includes(SCALDING)).length > 100,
    'the scalding warning must actually be present on the hot records',
  );
});


/**
 * Completeness, and the second instance of the same defect.
 *
 * Found by asking what else was scored once at normalize time. NCEI
 * enrichment fills a temperature into an existing record; the overlay stage
 * rescored and the merge stage rescored, but the enrichment stage between
 * them did not -- so 119 springs understated their score by exactly the field
 * they had just gained, showing 33% where 50% was true.
 */
test('every shipped record carries a completeness score matching a fresh computation', () => {
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const stale = all.filter((s) => {
    const c = completeness(s);
    return c.score !== s.quality.completeness
      || JSON.stringify(c.known) !== JSON.stringify(s.quality.known);
  });
  assert.deepEqual(stale.map((s) => s.id), [], `${stale.length} record(s) carry a stale score`);
  // Not vacuous: scores must actually vary, or an all-zero dataset would pass.
  const scores = new Set(all.map((s) => s.quality.completeness));
  assert.ok(scores.size > 3, 'completeness must be a real distribution, not a constant');
});

test('completeness is scored in exactly one place', () => {
  // The defect was possible because three copies existed -- normalize.mjs,
  // build-dataset.mjs and overlay.mjs -- and only two were called late enough.
  // They were identical, but two of them divided by their own FIRST_CLASS_COUNT
  // literal while normalize.mjs divided by FIRST_CLASS.length, so adding a
  // seventh first-class field would have scored /6 and /7 in the same build.
  const files = ['scripts/lib/normalize.mjs', 'scripts/lib/overlay.mjs', 'scripts/build-dataset.mjs'];
  const scorers = files.filter((f) => /known\.length \/ /.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(scorers, ['scripts/lib/normalize.mjs'],
    'only normalize.mjs may compute the completeness score');
  for (const f of files) {
    assert.ok(!/FIRST_CLASS_COUNT/.test(fs.readFileSync(f, 'utf8')),
      `${f} still carries its own copy of the denominator`);
  }
});
