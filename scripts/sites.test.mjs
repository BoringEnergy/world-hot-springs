import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { groupSites, sitesByCountry, SITE_LINK_METERS } from './lib/sites.mjs';
import { compileInventories, compareWithInventories } from './lib/completeness.mjs';

const M_PER_DEG_LAT = 111_195;
const rec = (id, lat, lng, country = 'XX', countryName = 'X') => ({ id, location: { lat, lng, country, countryName } });
const north = (m) => m / M_PER_DEG_LAT;
const east = (m, lat) => m / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));

test('the link is the accepted 500 m', () => {
  assert.equal(SITE_LINK_METERS, 500);
});

test('a chain of neighbours is one site even where its ends are far apart', () => {
  // A-B 400 m, B-C 400 m, A-C 800 m: single-linkage joins all three.
  const { sites } = groupSites([rec('a', 45, 10), rec('b', 45 + north(400), 10), rec('c', 45 + north(800), 10)]);
  assert.deepEqual(sites, [['a', 'b', 'c']]);
});

test('a pair just past the link is two sites, just inside it one', () => {
  assert.equal(groupSites([rec('a', 45, 10), rec('b', 45 + north(510), 10)]).sites.length, 2);
  assert.equal(groupSites([rec('a', 45, 10), rec('b', 45 + north(490), 10)]).sites.length, 1);
});

test('a lone spring is a site of one', () => {
  assert.deepEqual(groupSites([rec('a', 45, 10)]).sites, [['a']]);
});

test('an east-west pair near the pole is still found', () => {
  // A degree of longitude is 212 m wide at 79 N. With cells sized for the
  // equator, these two land two cells apart and are never compared.
  const lat = 79.4;
  const { sites } = groupSites([rec('a', lat, 13), rec('b', lat, 13 + east(450, lat))]);
  assert.equal(sites.length, 1);
});

test('grouping is deterministic, numbered by first appearance', () => {
  const rs = [rec('z', 45 + north(300), 10), rec('q', 10, 10), rec('a', 45, 10)];
  const { siteOf, sites } = groupSites(rs);
  assert.deepEqual(sites, [['z', 'a'], ['q']]);
  assert.equal(siteOf.get('a'), 0);
});

test('a site across a border counts in both countries, once in the total', () => {
  const rs = [rec('a', 45, 10, 'AA', 'A'), rec('b', 45 + north(100), 10, 'BB', 'B')];
  const { siteOf, sites } = groupSites(rs);
  assert.equal(sites.length, 1);
  assert.deepEqual(sitesByCountry(rs, siteOf), { A: 1, B: 1 });
});

test('a country counts its sites, not its features', () => {
  const rs = [rec('a', 45, 10), rec('b', 45 + north(50), 10), rec('c', 45 + north(90), 10), rec('d', 10, 10)];
  const { siteOf } = groupSites(rs);
  assert.deepEqual(sitesByCountry(rs, siteOf), { X: 2 });
});

const inv = (over = {}, count = {}) => ({
  inventories: [{
    id: 'jp', country: 'JP', publisher: 'P', title: 'T', url: 'https://example.go.jp/x.pdf',
    asOf: '2025-03-31', reviewed: '2026-09-23',
    counts: [{ unit: 'localities', count: 2839, comparesWith: 'sites', caveat: 'lodging only', ...count }],
    ...over,
  }],
});

test('an official count is compared with the unit it names, as a ratio', () => {
  const rows = compareWithInventories(compileInventories(inv()), {
    features: { JP: 1023 }, sites: { JP: 812 }, names: { JP: 'Japan' },
  });
  assert.deepEqual(rows.map((r) => [r.atlas, r.official, r.ratio, r.caveat]), [[812, 2839, 0.29, 'lodging only']]);
});

test('an inventory without a source, a caveat or a known unit is refused', () => {
  assert.throws(() => compileInventories(inv({ url: 'http://example.go.jp' })), /https/);
  assert.throws(() => compileInventories(inv({ country: 'Japan' })), /ISO/);
  assert.throws(() => compileInventories(inv({}, { caveat: '' })), /caveat/);
  assert.throws(() => compileInventories(inv({}, { comparesWith: 'springs' })), /features or sites/);
  assert.throws(() => compileInventories(inv({}, { count: 0 })), /positive integer/);
});

const SUMMARY = JSON.parse(fs.readFileSync('data/summary.json', 'utf8'));
const COMPLETENESS = JSON.parse(fs.readFileSync('data/completeness.json', 'utf8'));
const README = fs.readFileSync('README.md', 'utf8');

test('the shipped summary states both counts and the link that made the second', () => {
  assert.ok(SUMMARY.sites > 0 && SUMMARY.sites < SUMMARY.total);
  assert.equal(SUMMARY.siteLinkMeters, SITE_LINK_METERS);
  assert.equal(Object.keys(SUMMARY.sitesByCountry).length, SUMMARY.countries);
});

test("the README's Japan sentence is the shipped comparison", () => {
  const jp = COMPLETENESS.rows.find((r) => r.country === 'JP' && r.comparesWith === 'sites');
  const n = (x) => x.toLocaleString('en-US');
  const want = `holds ${n(jp.atlas)} sites beside ${n(jp.official)} official`;
  assert.ok(README.replace(/\s+/g, ' ').includes(want), `README should contain: ${want}`);
});

test("DATA.md's comparison table is the shipped comparison, row for row", () => {
  const data = fs.readFileSync('docs/DATA.md', 'utf8');
  const n = (x) => x.toLocaleString('en-US');
  for (const r of COMPLETENESS.rows) {
    const want = `| ${r.countryName} | ${n(r.official)} `;
    const row = data.split('\n').find((l) => l.startsWith(want));
    assert.ok(row, `DATA.md has no row starting ${want}`);
    assert.ok(row.includes(`| ${r.asOf} | ${n(r.atlas)} ${r.comparesWith} | ${r.ratio} |`), `stale row: ${row}`);
  }
});
