import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classify,
  toRecord,
  NCEI_PROVIDER,
  NCEI_SOURCE,
  NCEI_HISTORICAL_WARNING,
  NCEI_DOI_URL,
} from './lib/ncei-admit.mjs';

/** One no-bathing manager, shaped like data/land-managers.json. */
const MANAGERS = [
  {
    id: 'us-nps-yellowstone',
    bbox: [-111.156, 44.132, -109.816, 45.102],
    access: { status: 'view-only', bathingAllowed: false },
  },
  // A manager that permits bathing must NOT defer anything.
  { id: 'permissive', bbox: [0, 0, 1, 1], access: { bathingAllowed: true } },
];

const row = (over = {}) => ({
  state: 'NV',
  lat: 39.123,
  lng: -117.456,
  name: 'BARANOF WARM SPRINGS',
  celsius: 51,
  qualitative: null,
  ...over,
});

test('a named, precise, soak-class row outside every no-bathing park is admitted', () => {
  assert.deepEqual(classify(row(), MANAGERS), { admit: true });
});

test('a view-only feature is rejected', () => {
  for (const name of [
    'FUMAROLE',
    'FUMAROLES ON GARELOI ISLAND',
    'STEAM VENTS',
    'MUD POTS',
    'LITTLE GEYSERS',
  ]) {
    assert.deepEqual(
      classify(row({ name }), MANAGERS),
      { admit: false, reason: 'view-only feature' },
      name,
    );
  }
});

test('a name that claims water is soak-class even when it mentions a geyser', () => {
  // Measured: 13 real springs would be lost to a lexicon without this clause.
  for (const name of [
    'HOT SPRINGS NEAR GEYSER BIGHT',
    'GEYSER WARM SPRING',
    'BEOWAWE HOT SPRINGS (THE GEYSERS)',
  ]) {
    assert.deepEqual(classify(row({ name }), MANAGERS), { admit: true }, name);
  }
});

test('the feature words match whole words, never substrings', () => {
  // STEAMBOAT contains STEAM, BIDWELL contains WELL, SULPHUR is not a feature.
  for (const name of ['STEAMBOAT SPRINGS', 'FORT BIDWELL HOT SPRING', 'WHITE SULPHUR SPRINGS']) {
    assert.deepEqual(classify(row({ name }), MANAGERS), { admit: true }, name);
  }
});

test('a generic name is a coordinate wearing a type, and is rejected', () => {
  for (const name of ['HOT SPRINGS', 'WARM SPRING', 'SPRING', 'SEEP', 'HOT SPRING', 'SPRING (HOT)']) {
    assert.deepEqual(
      classify(row({ name }), MANAGERS),
      { admit: false, reason: 'generic or absent name' },
      name,
    );
  }
});

test('an absent name is rejected', () => {
  assert.deepEqual(classify(row({ name: null }), MANAGERS), {
    admit: false,
    reason: 'generic or absent name',
  });
});

test('coordinates coarser than 3 decimal places are rejected', () => {
  assert.deepEqual(classify(row({ lat: 39.12 }), MANAGERS), {
    admit: false,
    reason: 'coordinates coarser than 3 dp',
  });
  assert.deepEqual(classify(row({ lng: -117.4 }), MANAGERS), {
    admit: false,
    reason: 'coordinates coarser than 3 dp',
  });
  assert.deepEqual(
    classify(row({ lat: 39.1234 }), MANAGERS),
    { admit: true },
    '4 dp is finer than 3 and must pass',
  );
});

test('a row inside a no-bathing boundary is deferred, not admitted', () => {
  // 3 dp with non-zero final digits. A number literal does not keep trailing
  // zeros, so 44.600 is 44.6 and would trip the precision rule first -- which
  // is correct behaviour, but tests the wrong rule.
  const inPark = row({ lat: 44.612, lng: -110.523, name: 'SHELF SPRING' });
  assert.deepEqual(classify(inPark, MANAGERS), {
    admit: false,
    reason: 'inside a no-bathing boundary',
  });
});

test('a manager that allows bathing defers nothing', () => {
  const inPermissive = row({ lat: 0.512, lng: 0.523 });
  assert.deepEqual(classify(inPermissive, MANAGERS), { admit: true });
});

test('the rules are applied in a fixed order, so a row gets one reason', () => {
  // A generic name inside a park is reported as generic: the cheaper, more
  // specific reason wins, and a row must never carry two.
  const both = row({ name: 'HOT SPRINGS', lat: 44.612, lng: -110.523 });
  assert.equal(classify(both, MANAGERS).reason, 'generic or absent name');
});

const built = () =>
  toRecord(
    {
      state: 'AK',
      lat: 57.085,
      lng: -134.839,
      name: 'BARANOF WARM SPRINGS',
      celsius: 51,
      qualitative: null,
    },
    '2026-09-08',
  );

test('an admitted record declares its own source ref, or it can never get an id', () => {
  // identity.mjs throws by name for a record that yields no ref. This is the
  // field that stops that happening.
  assert.deepEqual(built().sourceRefs, [{ provider: 'ncei', externalId: 'AK/57.085/-134.839' }]);
  assert.equal(NCEI_PROVIDER, 'ncei');
});

test('an admitted record is NCEI-only in its provenance', () => {
  assert.deepEqual(built().quality.provenance, ['ncei']);
});

test('an admitted record is never verified and says when it was measured', () => {
  const r = built();
  assert.equal(r.verified, false);
  assert.equal(r.temperature.celsius, 51);
  assert.equal(r.temperature.fahrenheit, 123.8);
  assert.equal(r.temperature.measuredAt, '1981');
  assert.equal(r.temperature.source, NCEI_SOURCE);
  assert.match(NCEI_SOURCE, /10\.25921\/c8p0-zs06/);
});

test('an admitted record warns that its very existence is unchecked', () => {
  // Not just the reading. Nobody has confirmed the spring is still there.
  const r = built();
  assert.ok(r.warnings.includes(NCEI_HISTORICAL_WARNING));
  assert.match(NCEI_HISTORICAL_WARNING, /1981/);
  assert.match(NCEI_HISTORICAL_WARNING, /not been checked on the ground/i);
});

test('a scalding admitted record keeps the normal safety warning too', () => {
  const hot = toRecord(
    { state: 'WY', lat: 44.5, lng: -110.8, name: 'X SPRING', celsius: 92, qualitative: null },
    '2026-09-08',
  );
  assert.ok(hot.warnings.some((w) => /Scalding/.test(w)), 'the 50C rule must still apply');
  assert.ok(hot.warnings.includes(NCEI_HISTORICAL_WARNING));
});

test('a qualitative-only row carries the word and no number', () => {
  const q = toRecord(
    {
      state: 'AK',
      lat: 52.84,
      lng: -169.9,
      name: 'CHUGINADAK HOT SPRINGS',
      celsius: null,
      qualitative: 'hot',
    },
    '2026-09-08',
  );
  assert.equal(q.temperature.celsius, null);
  assert.equal(q.temperature.fahrenheit, null);
  assert.equal(q.temperature.qualitative, 'hot');
});

test('an admitted record cites the DOI and carries every schema field', () => {
  const r = built();
  assert.ok(r.sources.includes(NCEI_DOI_URL), 'sources holds the resolvable DOI URL');
  // Unknown is stored, never omitted -- the schema rule the whole record model
  // rests on. A missing key makes spring.minerals.ph throw in the UI.
  for (const k of ['access', 'clothing', 'hours', 'minerals', 'location', 'temperature', 'quality']) {
    assert.ok(r[k] && typeof r[k] === 'object', `${k} must be present`);
  }
  assert.equal(r.minerals.ph, null);
  assert.equal(r.access.status, 'unknown');
  assert.equal(r.location.country, 'US');
  assert.equal(r.type, 'natural');
});

test('sources holds a resolvable URL, because the UI renders it as a link', () => {
  // DetailPanel does <a href={src}>. A citation string there becomes a
  // relative link to nowhere, which looks like a source and is not one.
  const r = built();
  assert.deepEqual(r.sources, [NCEI_DOI_URL]);
  assert.match(NCEI_DOI_URL, /^https:\/\/doi\.org\/10\.25921\/c8p0-zs06$/);
  // The human-readable citation still belongs on the temperature, which is
  // rendered as text.
  assert.equal(r.temperature.source, NCEI_SOURCE);
});

test('an admitted record scores its completeness like any other', () => {
  // normalizeElement computes this for OSM records at the end. Left at zero,
  // an admitted record reads "0% complete" on a card that is showing its
  // temperature, which is visibly false.
  const r = built();
  assert.ok(r.quality.known.includes('name'), 'it has a name');
  assert.ok(r.quality.known.includes('temperature'), 'it has a temperature');
  assert.ok(r.quality.known.includes('type'), 'it is typed natural');
  assert.ok(r.quality.completeness > 0, `expected a score, got ${r.quality.completeness}`);
});

test('a qualitative-only record does not count as knowing a temperature', () => {
  const q = toRecord(
    { state: 'AK', lat: 52.84, lng: -169.9, name: 'CHUGINADAK HOT SPRINGS', celsius: null, qualitative: 'hot' },
    '2026-09-08',
  );
  assert.ok(!q.quality.known.includes('temperature'), '"hot" is not a measurement');
});
