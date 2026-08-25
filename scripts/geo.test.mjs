import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, normName } from './lib/geo.mjs';

test('distanceMeters: identical points are zero apart', () => {
  const p = { lat: 64.048, lng: -21.2222 };
  assert.equal(distanceMeters(p, p), 0);
});

test('distanceMeters: one degree of latitude is about 111km', () => {
  const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(d > 110_500 && d < 111_500, `expected ~111km, got ${Math.round(d)}m`);
});

test('distanceMeters: matches the Lahuen duplicate spacing that drove the 300m rule', () => {
  const a = { lat: -39.826478, lng: -71.636675 };
  const b = { lat: -39.822813, lng: -71.633676 };
  const d = distanceMeters(a, b);
  assert.ok(d > 350 && d < 550, `expected 350-550m, got ${Math.round(d)}m`);
});

test('normName: strips punctuation, case, and spacing', () => {
  assert.equal(normName('Termas de Lahuen Co'), 'termasdelahuenco');
  assert.equal(normName('Blue  Lagoon!'), 'bluelagoon');
});

test('normName: keeps non-Latin letters rather than emptying the string', () => {
  assert.equal(normName('登別温泉'), '登別温泉');
});

test('normName: null and undefined become empty string', () => {
  assert.equal(normName(null), '');
  assert.equal(normName(undefined), '');
});

test('normName: NFC and NFD spellings of the same name normalise identically', () => {
  const nfc = 'Café'.normalize('NFC');
  const nfd = 'Café'.normalize('NFD');
  assert.notEqual(nfc, nfd, 'fixture should actually differ at the codepoint level');
  assert.equal(normName(nfc), normName(nfd));

  const jaNfc = 'ガ'.normalize('NFC'); // ka + combining dakuten, precomposed
  const jaNfd = 'ガ'.normalize('NFD'); // same character, decomposed
  assert.notEqual(jaNfc, jaNfd, 'fixture should actually differ at the codepoint level');
  assert.equal(normName(jaNfc), normName(jaNfd));
});

test('distanceMeters: a short hop across the antimeridian is not most of the way around the planet', () => {
  const a = { lat: 0, lng: 179.999 };
  const b = { lat: 0, lng: -179.999 };
  const d = distanceMeters(a, b);
  assert.ok(d < 500, `expected a short distance across the antimeridian, got ${Math.round(d)}m`);
});

test('distanceMeters: a short separation near the pole is computed sanely', () => {
  const a = { lat: 89.9999, lng: 0 };
  const b = { lat: 89.9999, lng: 90 };
  const d = distanceMeters(a, b);
  assert.ok(d < 50, `expected a small distance near the pole, got ${Math.round(d)}m`);
});

test('distanceMeters: ~10m separations resolve finely enough to sit on either side of a 12m threshold', () => {
  const origin = { lat: 40, lng: -105 };
  const near = { lat: 40 + 10 / 111320, lng: -105 }; // ~10m north
  const far = { lat: 40 + 14 / 111320, lng: -105 }; // ~14m north
  const dNear = distanceMeters(origin, near);
  const dFar = distanceMeters(origin, far);
  assert.ok(dNear < 12, `expected under 12m, got ${dNear}m`);
  assert.ok(dFar > 12, `expected over 12m, got ${dFar}m`);
});
