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
