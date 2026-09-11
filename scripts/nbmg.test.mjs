/**
 * NBMG spring chemistry: the column mapping, the sentinels, and the key.
 *
 * Two of ten column mappings were wrong on the first attempt and both would
 * have published a figure on a rendered panel without failing, so the mapping
 * is tested against the real mirror rather than trusted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  toRow, num, yearOf, fromTsv, toTsv, COLUMNS, PANEL, TSV_COLUMNS, TSV_TEXT,
} from './lib/nbmg.mjs';
import { groupSites, agreedValue, matchNbmg, TOLERANCE, DEFAULT_TOLERANCE, NBMG_RADIUS_M } from './lib/nbmg-match.mjs';

const MIRROR = 'data/reference/nbmg-spring-chemistry.tsv';
const FIXTURE = fromTsv(fs.readFileSync('scripts/fixtures/nbmg-rows.tsv', 'utf8'));

test('the sentinels are refused, not read as numbers', () => {
  // -99999 read as a figure would publish a concentration no water has.
  for (const v of [-99999, -9999, -999]) assert.equal(num(v), null, String(v));
  assert.equal(num(0), 0, 'zero is a measurement');
  assert.equal(num(null), null);
  assert.equal(num('12'), null, 'a string is not a number here');
  assert.equal(num(47.2), 47.2);
});

test('a collection date is a year, or nothing', () => {
  assert.equal(yearOf(231897600000), '1977');
  assert.equal(yearOf(null), null);
  assert.equal(yearOf(-99999), null, 'the sentinel is not a date');
  // Pre-1970 dates are negative milliseconds and are ordinary: 2,754 Nevada
  // rows are older than the epoch.
  assert.equal(yearOf(Date.UTC(1955, 5, 12)), '1955');
});

test('the two zero-dates are refused, and only those', () => {
  // 927 rows land on 1900-01-01 to the millisecond and 8 on 1970-01-01 --
  // the classic placeholders for "no date entered". Published they would put
  // a fabricated analysis date on a card.
  assert.equal(yearOf(Date.UTC(1900, 0, 1)), null);
  assert.equal(yearOf(0), null, 'epoch zero is not a sampling date');
  // Every other 1900s and 1970s value is spread across real days and stays.
  assert.equal(yearOf(Date.UTC(1970, 9, 1)), '1970', '1970-10-01 is a real date');
  assert.equal(yearOf(Date.UTC(1900, 6, 4)), '1900');
});

test('bicarbonate comes from Bicarbonate_mgL, never from Alkalinity', () => {
  // Alkalinity is reported as CaCO3 equivalent and is a DIFFERENT quantity.
  // Mapping it would publish a wrong figure on a card, silently.
  assert.deepEqual(COLUMNS.bicarbonate, ['Bicarbonate_mgL']);
  const raw = fs.readFileSync('scripts/lib/nbmg.mjs', 'utf8');
  assert.ok(!/Alkalinity_mgL'\]/.test(raw), 'Alkalinity must not be mapped to a field');
});

test('iron is total iron, the same definition AIST uses', () => {
  // FeTot_mgL rather than Fe_mgL. One meaning of "iron" across two upstreams
  // is worth more than the extra rows the other column carries.
  assert.deepEqual(COLUMNS.iron, ['FeTot_mgL']);
});

test('pH prefers the field measurement over the lab one', () => {
  // Carbonate chemistry shifts on the way to a lab.
  assert.deepEqual(COLUMNS.ph, ['ph_Field', 'ph_Lab']);
  const onlyLab = toRow({ SamplingFeatureURI: 'u', LatDegree: 40, LongDegree: -117, ph_Lab: 7.1 }, 'NV');
  assert.equal(onlyLab.ph, 7.1, 'the lab value is used when there is no field one');
  const both = toRow({ SamplingFeatureURI: 'u', LatDegree: 40, LongDegree: -117, ph_Field: 6.4, ph_Lab: 7.1 }, 'NV');
  assert.equal(both.ph, 6.4);
});

test('tds is not mapped, because the source never populates it', () => {
  // TotalDissolvedSolids_mgL exists in two layers and is null in all 3,683
  // rows. An empty column, an absent column and a broken mapping look alike
  // until someone reads the data, so this records which one it is.
  assert.ok(!PANEL.includes('tds'));
  const raw = fs.readFileSync(MIRROR, 'utf8');
  assert.ok(!raw.split('\n').find((l) => l.startsWith('site\t'))?.includes('tds'));
});

test('a row with no panel value at all is dropped', () => {
  assert.equal(toRow({ SamplingFeatureURI: 'u', LatDegree: 40, LongDegree: -117 }, 'NV'), null);
  // And one with no usable position, which could match nothing anyway.
  assert.equal(toRow({ SamplingFeatureURI: 'u', LatDegree: -99999, LongDegree: -117, Ca_mgL: 5 }, 'NV'), null);
  assert.equal(toRow({ LatDegree: 40, LongDegree: -117, Ca_mgL: 5 }, 'NV'), null, 'no site URI');
});

test('the mirror round-trips, text as text and measurements as numbers', () => {
  const back = fromTsv(toTsv(FIXTURE));
  assert.equal(back.length, FIXTURE.length);
  for (const col of TSV_COLUMNS) {
    for (const r of back.filter((x) => x[col] !== null)) {
      assert.equal(typeof r[col], TSV_TEXT.has(col) ? 'string' : 'number', `${col} came back wrong`);
    }
  }
});

test('sites are keyed by POSITION, not by SamplingFeatureURI', () => {
  // The key that looks obvious and is wrong. Colorado issues a separate
  // feature URI per analysis -- one position carries ten, alongside a URI
  // derived from the coordinate itself. Keyed by URI they become competing
  // sites and trip the contention rule; it cost 11 of 109 springs.
  const sites = groupSites(FIXTURE);
  const uriCount = new Set(FIXTURE.map((r) => r.site)).size;
  const posCount = new Set(FIXTURE.map((r) => `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`)).size;
  assert.ok(uriCount > posCount, 'the fixture must contain the multi-URI case');
  assert.equal(sites.size, posCount);
  const many = [...sites.values()].find((s) => s.uris.size > 1);
  assert.ok(many, 'one grouped site must carry several URIs');
});

test('agreement uses AIST absolute tolerances, not a percentage', () => {
  assert.equal(TOLERANCE.ph, 0.1);
  assert.equal(TOLERANCE.iron, 0.1);
  assert.equal(DEFAULT_TOLERANCE, 1);
  // 5% was the placeholder and is LOOSER: 5% of 2,000 mg/L is 100 mg/L.
  assert.equal(agreedValue([2000, 2050], 'chloride'), null, '50 apart is not agreement');
  assert.equal(agreedValue([2000, 2000.5], 'chloride'), 2000);
  assert.equal(agreedValue([7.1, 7.3], 'ph'), null);
  assert.equal(agreedValue([7.1, 7.15], 'ph'), 7.1);
  assert.equal(agreedValue([], 'ph'), null);
});

test('a disagreeing field is withheld while its neighbours publish', () => {
  // Per FIELD, not per panel. One unstable constituent must not cost the
  // nine that agree.
  const rows = [
    { site: 'a', name: 'X', state: 'NV', lat: 40, lng: -117, measuredAt: '1980', calcium: 50, chloride: 10 },
    { site: 'b', name: 'X', state: 'NV', lat: 40, lng: -117, measuredAt: '1990', calcium: 50.2, chloride: 900 },
  ];
  const rec = { id: 's1', location: { lat: 40, lng: -117 }, minerals: Object.fromEntries(PANEL.map((f) => [f, null])) };
  const { matched } = matchNbmg(rows, [rec]);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].values.calcium, 50);
  assert.ok(!('chloride' in matched[0].values));
  assert.deepEqual(matched[0].withheldFields, ['chloride']);
  assert.equal(matched[0].measuredAt, '1990', 'the most recent year any analysis states');
});

test('contention runs both ways', () => {
  const bare = () => Object.fromEntries(PANEL.map((f) => [f, null]));
  const site = (lat, lng, ca) => ({ site: `${lat}`, name: 'X', state: 'NV', lat, lng, measuredAt: '1990', calcium: ca });
  const north = (lat, m) => lat + m / 111320;
  // Several sites near one spring.
  let r = matchNbmg([site(north(40, 40), -117, 10), site(north(40, 80), -117, 90)],
    [{ id: 's1', location: { lat: 40, lng: -117 }, minerals: bare() }]);
  assert.equal(r.matched.length, 0);
  assert.match(r.withheld[0].reason, /2 chemistry sites within 200 m/);
  // One site near several springs -- the direction WQP missed, at a cost of
  // 142 matches down to 40.
  r = matchNbmg([site(40, -117, 10)], [
    { id: 's1', location: { lat: north(40, 30), lng: -117 }, minerals: bare() },
    { id: 's2', location: { lat: north(40, -30), lng: -117 }, minerals: bare() },
  ]);
  assert.equal(r.matched.length, 0, 'one analysis cannot describe two springs');
  assert.equal(r.withheld.length, 2);
  for (const w of r.withheld) assert.match(w.reason, /one site is within 200 m of 2 springs/);
});

test('a spring that already holds chemistry is left alone', () => {
  const rec = {
    id: 's1', location: { lat: 40, lng: -117 },
    minerals: { ...Object.fromEntries(PANEL.map((f) => [f, null])), calcium: 99 },
  };
  const { matched } = matchNbmg([{ site: 'a', name: 'X', state: 'NV', lat: 40, lng: -117, calcium: 50 }], [rec]);
  assert.equal(matched.length, 0, 'two sources must not be mixed into one panel');
});

test('the radius is the same 200 m every other upstream uses', () => {
  assert.equal(NBMG_RADIUS_M, 200);
});

test('what shipped agrees with the report, and states its unit', () => {
  const report = JSON.parse(fs.readFileSync('data/nbmg-match-report.json', 'utf8'));
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const byId = new Map(all.map((s) => [s.id, s]));
  const enriched = all.filter((s) => s.quality.provenance.includes('nbmg'));
  assert.equal(enriched.length, report.counts.panelsWritten);
  assert.ok(enriched.length > 50, 'not vacuous: the upstream really did enrich records');
  for (const m of report.matched) {
    const rec = byId.get(m.id);
    if (!rec?.quality.provenance.includes('nbmg')) continue;
    for (const [f, v] of Object.entries(m.values)) assert.equal(rec.minerals[f], v, `${m.id}.${f}`);
    // Every column in this source names mg/L, so a panel from it is never
    // unqualified. pH alone implies no unit.
    if (Object.keys(m.values).some((f) => f !== 'ph')) assert.equal(rec.minerals.unit, 'mg/l', m.id);
  }
});

test('no site enriched more than one spring', () => {
  const report = JSON.parse(fs.readFileSync('data/nbmg-match-report.json', 'utf8'));
  const seen = new Map();
  for (const m of report.matched) seen.set(m.site, (seen.get(m.site) ?? 0) + 1);
  assert.deepEqual([...seen.entries()].filter(([, n]) => n > 1), []);
});

test('the mirror carries no temperature, and the fetcher says why', () => {
  // This service publishes FluidTemperature_C on almost every row. It yields
  // twelve springs against the atlas and is CLOSED, not deferred -- so the
  // omission must read as a decision rather than an oversight.
  const header = fs.readFileSync(MIRROR, 'utf8').split('\n').find((l) => l.startsWith('site\t'));
  assert.ok(!/temp/i.test(header), 'no temperature column in the mirror');
  assert.match(fs.readFileSync('scripts/fetch-nbmg.mjs', 'utf8'), /twelve springs/);
});
