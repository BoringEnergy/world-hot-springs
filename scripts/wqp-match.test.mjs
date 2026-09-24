/**
 * Matching a USGS/EPA reading to a spring the atlas already holds.
 *
 * The contention rule is the whole safety argument here, and it runs in TWO
 * directions. The spec measured only one and predicted 270 springs; with both,
 * the answer is 40. These tests exist so that difference cannot be lost again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  matchWqp, compareWqp, agreedReading, groupStations, WQP_RADIUS_M, AGREEMENT_C, PLAUSIBLE_MAX_C,
} from './lib/wqp-match.mjs';

const spring = (id, lat, lng) => ({
  id, name: id, location: { lat, lng }, temperature: { celsius: null },
});
const reading = (station, lat, lng, celsius, measuredAt = '2001-01-01', name = 'S') =>
  ({ station, name, lat, lng, celsius, measuredAt });
/** ~N metres north, for just-inside and just-outside cases. */
const north = (lat, m) => lat + m / 111320;

test('the radius is the same 200 m the other upstreams use', () => {
  // Two upstreams, one positional standard. A looser gate here would mean the
  // project held a different evidence bar for the United States.
  assert.equal(WQP_RADIUS_M, 200);
  assert.equal(AGREEMENT_C, 2);
});

test('a single station in range enriches its spring', () => {
  const { matched, withheld } = matchWqp(
    [reading('A', north(40, 50), -118, 47.5, '1994-06-01')],
    [spring('s1', 40, -118)],
  );
  assert.equal(matched.length, 1);
  assert.equal(withheld.length, 0);
  assert.equal(matched[0].celsius, 47.5);
  assert.equal(matched[0].measuredAt, '1994-06-01');
  assert.equal(matched[0].station, 'A');
});

test('a station outside the radius is not a match', () => {
  const { matched } = matchWqp(
    [reading('A', north(40, 260), -118, 47.5)],
    [spring('s1', 40, -118)],
  );
  assert.equal(matched.length, 0);
});

test('many stations near one spring is contention, and publishes nothing', () => {
  // Great Boiling Spring: 17 stations within 200 m carrying 0 C to 100 C. It
  // is a spring field plus ambient measurements. Max publishes 100, min
  // publishes 0, mean publishes a number nobody measured.
  const { matched, withheld } = matchWqp(
    [reading('A', north(40, 40), -118, 100), reading('B', north(40, 60), -118, 0)],
    [spring('s1', 40, -118)],
  );
  assert.equal(matched.length, 0);
  assert.equal(withheld.length, 1);
  assert.match(withheld[0].reason, /2 stations within 200 m/);
});

test('ONE station near many springs is contention too, and it is the expensive one', () => {
  // The direction the spec missed. USGS-444353110422301 sits within 200 m of
  // 21 atlas springs in Yellowstone, where OSM maps individual vents.
  // Publishing its reading to all of them asserts 21 facts from one
  // measurement. Costs 116 of 159 matches nationally -- 142 down to 40.
  const { matched, withheld } = matchWqp(
    [reading('A', 40, -118, 87)],
    [spring('s1', north(40, 30), -118), spring('s2', north(40, -30), -118)],
  );
  assert.equal(matched.length, 0, 'one measurement cannot describe two springs');
  assert.equal(withheld.length, 2);
  for (const w of withheld) assert.match(w.reason, /station A is within 200 m of 2 springs/);
});

test('a station shared with a spring that already has a temperature is still free', () => {
  // Contention is counted over springs this stage could actually write to. A
  // neighbour that already knows its temperature is not competing for the
  // reading, so withholding on its account would lose a sound match.
  const known = { ...spring('s2', north(40, 30), -118), temperature: { celsius: 60 } };
  const { matched } = matchWqp([reading('A', 40, -118, 87)], [spring('s1', north(40, -30), -118), known]);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, 's1');
});

test('readings that disagree publish nothing, and say how far apart they were', () => {
  // The same point measured repeatedly, sometimes decades apart. A spring
  // ranging more than a couple of degrees is one no single figure describes.
  const { matched, withheld } = matchWqp(
    [reading('A', 40, -118, 30, '1970-01-01'), reading('A', 40, -118, 44, '2010-01-01')],
    [spring('s1', 40, -118)],
  );
  assert.equal(matched.length, 0);
  assert.match(withheld[0].reason, /span 14\.0 C/);
});

test('agreeing readings publish the most recent, never the mean or the maximum', () => {
  // Not the mean, which is computed. Not the maximum, which is cherry-picking
  // in the direction that flatters a hot-spring atlas.
  const r = agreedReading([
    { celsius: 48, measuredAt: '1961-07-02' },
    { celsius: 47, measuredAt: '2004-09-15' },
    { celsius: 48.5, measuredAt: '1988-01-01' },
  ]);
  assert.equal(r.celsius, 47, 'the most recent, though it is neither mean nor max');
  assert.equal(r.measuredAt, '2004-09-15');
});

test('an undated reading sorts last, so a dated figure wins', () => {
  const r = agreedReading([
    { celsius: 40, measuredAt: null },
    { celsius: 41, measuredAt: '1999-01-01' },
  ]);
  assert.equal(r.measuredAt, '1999-01-01', 'a figure whose age is known beats one whose age is not');
});

test('a station with no usable reading is dropped rather than defaulted', () => {
  const stations = groupStations([
    { station: 'A', lat: 40, lng: -118, celsius: 50, measuredAt: '2001-01-01' },
    { station: 'B', lat: 40, lng: -118, celsius: null, measuredAt: '2001-01-01' },
    { station: 'C', lat: Number.NaN, lng: -118, celsius: 50, measuredAt: '2001-01-01' },
  ]);
  assert.deepEqual([...stations.keys()], ['A']);
});

test('a spring that already has a temperature is never overwritten', () => {
  const known = { ...spring('s1', 40, -118), temperature: { celsius: 61 } };
  const { matched } = matchWqp([reading('A', 40, -118, 47)], [known]);
  assert.equal(matched.length, 0);
});

test('the shipped dataset agrees with the report, and nothing was invented', () => {
  const report = JSON.parse(fs.readFileSync('data/wqp-match-report.json', 'utf8'));
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const byId = new Map(all.map((s) => [s.id, s]));
  const enriched = all.filter((s) => s.quality.provenance.includes('wqp'));
  assert.equal(enriched.length, report.counts.filled);
  assert.ok(enriched.length > 20, 'not vacuous: the upstream really did enrich records');
  for (const m of report.matched) {
    const rec = byId.get(m.id);
    if (!rec.quality.provenance.includes('wqp')) continue;
    assert.equal(rec.temperature.celsius, m.celsius, `${m.id} does not match the report`);
    // USGS measures at the monitoring location, which for a spring site is
    // the spring, so every one of these is a source reading.
    assert.equal(rec.temperature.kind, 'source');
    assert.match(rec.temperature.source, /Water Quality Portal/);
  }
});

test('no spring is enriched by a station that also serves another', () => {
  // The data half of the second contention rule, checked against what shipped
  // rather than against the matcher that produced it.
  const report = JSON.parse(fs.readFileSync('data/wqp-match-report.json', 'utf8'));
  const seen = new Map();
  for (const m of report.matched) seen.set(m.station, (seen.get(m.station) ?? 0) + 1);
  const shared = [...seen.entries()].filter(([, n]) => n > 1);
  assert.deepEqual(shared, [], 'a station may enrich at most one spring');
});

test('a reading above boiling is not a reading of spring water, and is dropped alone', () => {
  assert.equal(PLAUSIBLE_MAX_C, 100);
  const st = groupStations([
    reading('A', 40, -118, 1152, '2000-02-02'),
    reading('A', 40, -118, 41, '1999-01-01'),
    reading('A', 40, -118, 42, '2001-01-01'),
  ]).get('A');
  assert.deepEqual(st.readings.map((r) => r.celsius), [41, 42], 'the sound readings survive and can agree');
  assert.equal(groupStations([reading('B', 40, -118, 100)]).get('B').readings.length, 1, '100 C itself is possible');
});

const known = (id, lat, lng, celsius, source = 'NOAA') => ({ ...spring(id, lat, lng), temperature: { celsius, source } });

test('a second measurement that agrees is corroboration; one that disagrees is a conflict', () => {
  const { corroborated, conflicts } = compareWqp(
    [reading('A', 40, -118, 59.5, '1980-08-19'), reading('B', 41, -118, 17, '1974-01-01')],
    [known('agrees', 40, -118, 60), known('differs', 41, -118, 52)],
  );
  assert.deepEqual(corroborated.map((c) => [c.id, c.atlas, c.wqp]), [['agrees', 60, 59.5]]);
  assert.deepEqual(conflicts.map((c) => [c.id, c.atlas, c.wqp, c.wqpMeasuredAt]), [['differs', 52, 17, '1974-01-01']]);
});

test('comparison never writes, and never looks at a spring with no value', () => {
  const s = spring('empty', 40, -118);
  const k = known('k', 41, -118, 52);
  const { corroborated, conflicts } = compareWqp([reading('A', 40, -118, 50), reading('B', 41, -118, 17)], [s, k]);
  assert.equal(corroborated.length + conflicts.length, 1);
  assert.equal(s.temperature.celsius, null);
  assert.equal(k.temperature.celsius, 52);
});

test('a station near two springs is not compared with either, even if one has no value', () => {
  // Unlike the fill pass: the question is whether the reading is OF this spring.
  const { corroborated, conflicts } = compareWqp(
    [reading('A', 40, -118, 17)],
    [known('k', north(40, 30), -118, 52), spring('neighbour', north(40, -30), -118)],
  );
  assert.equal(corroborated.length + conflicts.length, 0);
});

test('a spring with two stations in range, or a station whose readings disagree, is not compared', () => {
  const two = compareWqp([reading('A', 40, -118, 17), reading('B', north(40, 50), -118, 52)], [known('k', 40, -118, 52)]);
  assert.equal(two.corroborated.length + two.conflicts.length, 0);
  const spread = compareWqp([reading('A', 40, -118, 30), reading('A', 40, -118, 52)], [known('k', 40, -118, 52)]);
  assert.equal(spread.corroborated.length + spread.conflicts.length, 0);
});

test('the shipped report sorts every comparison by the tolerance it states', () => {
  const report = JSON.parse(fs.readFileSync('data/wqp-match-report.json', 'utf8'));
  assert.equal(report.counts.corroborated, report.corroborated.length);
  assert.equal(report.counts.conflicts, report.conflicts.length);
  assert.ok(report.corroborated.length > 50, 'not vacuous');
  for (const c of report.corroborated) assert.ok(Math.abs(c.atlas - c.wqp) <= AGREEMENT_C, c.id);
  for (const c of report.conflicts) assert.ok(Math.abs(c.atlas - c.wqp) > AGREEMENT_C, c.id);
  for (const c of [...report.corroborated, ...report.conflicts]) assert.ok(c.wqp <= PLAUSIBLE_MAX_C, c.id);
});
