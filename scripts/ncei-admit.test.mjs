import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './lib/ncei-admit.mjs';

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
