/**
 * The Water Quality Portal mirror: the parser, the units, and the grid.
 *
 * Fixtures are REAL bytes from the live service, cut from the Nevada pilot
 * that the spec was measured on. A synthetic CSV would not have taught me
 * that seven of Nevada's readings are in Fahrenheit, or that the bounding
 * box takes longitude first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseStations, parseResults, joinReadings, celsiusOf, tileUrl,
  toTsv, fromTsv, TILES, TSV_COLUMNS, TSV_TEXT,
} from './lib/wqp.mjs';

const STATIONS = fs.readFileSync('scripts/fixtures/wqp-stations.csv', 'utf8');
const RESULTS = fs.readFileSync('scripts/fixtures/wqp-results.csv', 'utf8');

test('a station is read with a usable position or not at all', () => {
  const stations = parseStations(STATIONS);
  assert.equal(stations.size, 7);
  for (const st of stations.values()) {
    assert.ok(Number.isFinite(st.lat) && Number.isFinite(st.lng), st.id);
    // Nevada. A station defaulted to 0,0 would sit in the Gulf of Guinea and
    // match nothing, silently.
    assert.ok(st.lat > 35 && st.lat < 43, `${st.id} lat ${st.lat}`);
    assert.ok(st.lng > -121 && st.lng < -114, `${st.id} lng ${st.lng}`);
  }
});

test('readings are one row each, not one per station', () => {
  // A spring measured six times is six readings. Collapsing them in the
  // mirror would decide, here, a question that belongs to the matcher.
  const results = parseResults(RESULTS);
  assert.equal(results.length, 7);
  for (const r of results) {
    assert.ok(r.station.startsWith('USGS-'));
    assert.ok(Number.isFinite(r.value));
  }
});

test('Fahrenheit is converted, and an unknown unit is refused', () => {
  // 7 of Nevada's 2,329 readings are `deg F`. Assuming Celsius would publish
  // 104 as a temperature no spring has.
  assert.equal(celsiusOf(104, 'deg F'), 40);
  assert.equal(celsiusOf(40, 'deg C'), 40);
  assert.equal(celsiusOf(40, 'C'), 40);
  assert.equal(celsiusOf(40, 'deg K'), null, 'an unrecognised unit is not Celsius');
  assert.equal(celsiusOf(40, ''), null);
  assert.equal(celsiusOf(Number.NaN, 'deg C'), null);
  // The fixture really does carry both branches.
  assert.ok(RESULTS.includes('deg F'));
  assert.ok(RESULTS.includes('deg C'));
});

test('joining drops a reading whose station is not in the tile', () => {
  // The two queries are taken seconds apart against a LIVE service, so the
  // result set can name a station the station set does not. A reading with
  // no position is not a fact about anywhere.
  const stations = parseStations(STATIONS);
  const results = parseResults(RESULTS);
  assert.equal(joinReadings(stations, results).length, 7);
  assert.equal(joinReadings(new Map(), results).length, 0);
  const orphan = [{ station: 'USGS-nowhere', measuredAt: '2001-01-01', value: 40, unit: 'deg C' }];
  assert.equal(joinReadings(stations, orphan).length, 0);
});

test('every joined reading carries a position and a Celsius value', () => {
  const rows = joinReadings(parseStations(STATIONS), parseResults(RESULTS));
  for (const r of rows) {
    assert.ok(Number.isFinite(r.lat) && Number.isFinite(r.lng));
    assert.ok(Number.isFinite(r.celsius));
    assert.equal(typeof r.station, 'string');
  }
});

test('the mirror round-trips, and text stays text', () => {
  // The lesson from the AIST mirror, which silently lost every silica
  // reading because one column came back as a string.
  const rows = joinReadings(parseStations(STATIONS), parseResults(RESULTS));
  const back = fromTsv(toTsv(rows));
  assert.equal(back.length, rows.length);
  for (const col of TSV_COLUMNS) {
    const stated = back.filter((r) => r[col] !== null);
    assert.ok(stated.length > 0, `${col} is empty in the mirror`);
    for (const r of stated) {
      assert.equal(typeof r[col], TSV_TEXT.has(col) ? 'string' : 'number', `${col} came back wrong`);
    }
  }
  assert.deepEqual(back[0].celsius, rows[0].celsius);
});

test('a tab inside a station name cannot shift the columns', () => {
  // Station names are free text typed by field staff, and the mirror is
  // tab-separated. One stray tab would move every later column on that row.
  const rows = [{ station: 'X', name: 'Hot\tSpring\nNo. 2', lat: 40, lng: -117, measuredAt: '2001-01-01', celsius: 50 }];
  const tsv = toTsv(rows);
  assert.equal(tsv.trim().split('\n').length, 2, 'one header, one row');
  const back = fromTsv(tsv);
  assert.equal(back.length, 1);
  assert.equal(back[0].celsius, 50, 'the last column survived');
  assert.equal(back[0].name, 'Hot Spring No. 2');
});

test('the bounding box is longitude first', () => {
  // WQP writes bBox as west,south,east,north. Every other coordinate in this
  // repository is lat,lng, so getting this backwards would query the wrong
  // hemisphere and return an empty file that looks like an honest miss.
  const url = tileUrl('Station', [40, -118]);
  assert.ok(url.includes('bBox=-118,40,-116,42'), url);
  assert.ok(url.includes('siteType=Spring'));
  assert.ok(!url.includes('dataProfile'), 'only the Result query takes a profile');
  assert.ok(tileUrl('Result', [40, -118]).includes('dataProfile=narrowResult'));
});

test('the grid is frozen, and covers the springs it was cut for', () => {
  // Derived once from every US spring, then fixed. Deriving it at fetch time
  // from the current dataset would mean the query set moved whenever the
  // atlas did, and a snapshot whose own scope moves is a snapshot of nothing.
  assert.equal(TILES.length, 133);
  for (const [lat, lng] of TILES) {
    // Math.abs, because a negative longitude gives `-0` and assert/strict
    // compares with Object.is, under which -0 is not 0.
    assert.equal(Math.abs(lat % 2), 0, `tile ${lat},${lng} is off-grid`);
    assert.equal(Math.abs(lng % 2), 0, `tile ${lat},${lng} is off-grid`);
  }
  const keys = new Set(TILES.map(([a, b]) => `${a},${b}`));
  assert.equal(keys.size, TILES.length, 'a duplicated tile is a minute wasted, twice');

  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const us = all.filter((s) => s.location.countryName === 'United States of America');
  const uncovered = us.filter((s) => !keys.has(
    `${Math.floor(s.location.lat / 2) * 2},${Math.floor(s.location.lng / 2) * 2}`,
  ));
  // Springs added since the grid was cut may fall outside it. That is a fact
  // to see, not a failure -- but a large drift means the grid needs recutting.
  assert.ok(uncovered.length <= 20,
    `${uncovered.length} US springs sit outside the frozen grid; recut it`);
});
