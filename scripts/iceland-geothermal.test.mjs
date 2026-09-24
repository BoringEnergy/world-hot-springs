import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toTsv, fromTsv, findGaps, rowsFromGeoJson, GAP_METERS, LOOK_AT } from './lib/iceland-geothermal.mjs';

const M = 111_195;
const pt = (id, type, lat, lng = -21) => ({ id, type, lat, lng, accuracyMeters: 500 });
const rec = (lat, lng = -21) => ({ location: { lat, lng } });

test('the mirror round-trips, sorted by id', () => {
  const rows = rowsFromGeoJson({ features: [
    { properties: { objectid: 2, hverirNI: 'laug', nakvaemniXY: 500 }, geometry: { coordinates: [-21.1, 64.2] } },
    { properties: { objectid: 1, hverirNI: 'gufa', nakvaemniXY: 500 }, geometry: { coordinates: [-21.2, 64.1] } },
  ] });
  assert.deepEqual(rows.map((r) => r.id), [1, 2]);
  assert.deepEqual(fromTsv(toTsv(rows, '2026-09-24')), rows);
});

test('a hand-edited mirror is refused', () => {
  const tsv = toTsv([pt(1, 'volgra', 64.1)], '2026-09-24');
  assert.throws(() => fromTsv(tsv.replace('volgra', 'laug')), /sha256/);
});

test('only warm, hot and carbonated springs are looked at; seeps, steam and volcanoes are not', () => {
  assert.deepEqual(LOOK_AT, ['laug', 'kolsýrulaugar', 'hver']);
  const points = ['laug', 'kolsýrulaugar', 'hver', 'volgra', 'gufa', 'hiti í virkum eldstöðvum'].map((t, i) => pt(i, t, 64));
  assert.deepEqual(findGaps(points, []).map((g) => g.type), LOOK_AT);
});

test('a point is a gap only past twice its stated accuracy from every atlas record', () => {
  assert.equal(GAP_METERS, 1000);
  const near = findGaps([pt(1, 'laug', 64)], [rec(64 + 900 / M)]);
  const far = findGaps([pt(1, 'laug', 64)], [rec(64 + 1100 / M)]);
  assert.equal(near.length, 0);
  assert.equal(far.length, 1);
  assert.ok(Math.abs(far[0].nearestAtlasMeters - 1100) <= 5);
});

test('the shipped worklist is built from the committed mirror and carries its attribution', () => {
  const report = JSON.parse(fs.readFileSync('data/iceland-candidates.json', 'utf8'));
  const points = fromTsv(fs.readFileSync('data/reference/iceland-geothermal-2003.tsv', 'utf8'));
  assert.equal(points.length, 1037);
  assert.match(report.attribution, /Náttúrufræðistofnun .*CC BY 4\.0/);
  assert.equal(report.candidates.length, Object.values(report.counts).reduce((a, b) => a + b, 0));
  for (const c of report.candidates) assert.ok(c.nearestAtlasMeters > GAP_METERS && LOOK_AT.includes(c.type), c.id);
});

test('the worklist adds no spring to the atlas', () => {
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  assert.ok(all.every((r) => !r.sources.some((s) => /gis\.lmi\.is|natt\.is/.test(s))));
});
