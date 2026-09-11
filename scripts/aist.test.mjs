/**
 * AIST: the parser traps, the name standard, and the contention rule.
 *
 * Every test here exists because the thing it checks was got wrong first, in
 * this order: the encoding, the date format, and a chemistry panel written
 * without the unit that qualifies it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseCsv, centroidOf, sampledYear, unitOf, fromTsv, TSV_COLUMNS, TSV_TEXT,
} from './lib/aist.mjs';
import {
  nameAgreement, agreedValue, agreedUnit, agreedYear, stripped, AIST_RADIUS_M,
} from './lib/aist-match.mjs';
import { MIN_SUBSTRING_NAME_LENGTH } from './lib/identity.mjs';

test('a comma inside WKT geometry does not shift the columns', () => {
  // The reason a real CSV parser is not optional. `位置` holds a polygon whose
  // vertices are comma-separated, so split(',') moves every later column --
  // silently, because the row still parses and still has cells in it.
  const line = 'a,b,"POLYGON((144.31 43.58,144.32 43.57,144.31 43.58))",1977.5,98.20\n';
  const [row] = parseCsv(line);
  assert.equal(row.length, 5, `naive splitting gives 7; got ${row.length}`);
  assert.match(row[2], /^POLYGON/);
  assert.equal(row[4], '98.20');
});

test('a doubled quote inside a quoted field is one quote', () => {
  const [row] = parseCsv('a,"say ""hi""",b\n');
  assert.deepEqual(row, ['a', 'say "hi"', 'b']);
});

test('the centroid of a published cell is inside the cell', () => {
  const c = centroidOf('POLYGON((144.313281 43.582369,144.314034 43.581468,'
    + '144.313082 43.580672,144.311741 43.581081,144.311863 43.582129,144.313281 43.582369))');
  assert.ok(c.lng > 144.3117 && c.lng < 144.3141, `lng ${c.lng}`);
  assert.ok(c.lat > 43.5806 && c.lat < 43.5824, `lat ${c.lat}`);
});

test('geometry that is not a polygon is rejected, not defaulted', () => {
  // A row with no position cannot match anything, and defaulting it to 0,0
  // would put it in the Gulf of Guinea and inside nothing.
  assert.equal(centroidOf('N/A'), null);
  assert.equal(centroidOf(''), null);
  assert.equal(centroidOf('POINT(144.3 43.5)'), null);
});

test('the sampled year is read as a dotted date, not a decimal number', () => {
  // The spec proposing this import called 採水年月日 "a decimal year (1978.5)".
  // It is a dotted DATE: 1,756 rows are YYYY.MM.DD and 1,346 are YYYY.M.DD.
  // Number("1977.12.25") is NaN, so reading it as a number discarded 83% of
  // the dates this file publishes -- and discarded them as an absent
  // measuredAt, which is indistinguishable from a row that stated none.
  assert.equal(sampledYear('1977.12.25'), '1977');
  assert.equal(sampledYear('1978.5'), '1978');
  assert.equal(sampledYear('1978.5.9'), '1978');
  assert.equal(sampledYear('1991'), '1991');
  assert.equal(sampledYear('1975～1980'), '1975', 'a range takes the year stated first');
  assert.equal(sampledYear('N/A'), null);
  assert.equal(sampledYear(''), null);
  assert.equal(sampledYear('12.25'), null, 'no four-digit year is no year');
});

test('only a unit the source actually printed is carried', () => {
  assert.equal(unitOf('mg/kg'), 'mg/kg');
  assert.equal(unitOf('mg/l'), 'mg/l');
  // One row holds "0.0002" in the unit column. That is garbage, not a unit,
  // and null is the honest reading of it.
  assert.equal(unitOf('0.0002'), null);
  assert.equal(unitOf('N/A'), null);
});

test('the name standard is the one identity.mjs already argued for', () => {
  // Substring agreement needs both stripped names to carry information.
  // Accepting short ones at the 200 m gate would take the yield from ~20 to
  // 130 -- and 91 of those rest on three characters or fewer, in a country
  // where onsen cluster, against a source whose position is a 190 m cell.
  assert.equal(nameAgreement('草津温泉', '草津温泉'), 'exact');
  assert.equal(nameAgreement('森林公園温泉；きよら', '森林公園'), 'substring');
  // Two characters inside a longer name is a coincidence with a story.
  assert.equal(nameAgreement('白樺リゾート池の平ホテル', '白樺'), null);
  assert.equal(stripped('白樺').length, 2);
  assert.ok(stripped('白樺').length < MIN_SUBSTRING_NAME_LENGTH);
});

test('short names stay eligible for exact agreement', () => {
  // The resolved rule: the length bar governs SUBSTRING evidence only. Two
  // short names that are the same name are still the same name -- 瀬波温泉
  // and 瀬波 agree at 1 m apart.
  assert.equal(nameAgreement('瀬波温泉', '瀬波'), 'exact');
  assert.equal(nameAgreement('鷺の湯温泉', '鷺ノ湯'), 'exact', 'kana variants normalise together');
});

test('an unnamed side is not agreement', () => {
  // NCEI treats one unnamed side as "not a disagreement" because at 200 m
  // proximity carries the identity. Here a group of wells can sit anywhere in
  // a 190 m cell, so an absent name is absence of evidence.
  assert.equal(nameAgreement(null, '草津温泉'), null);
  assert.equal(nameAgreement('草津温泉', ''), null);
});

test('wells that disagree publish nothing, and are never averaged', () => {
  // Under one onsen name the wells genuinely differ -- different depths,
  // different sources. Averaging or taking the nearest computes a value
  // nobody published, which is what rule 2 forbids.
  const wells = [{ celsius: 48 }, { celsius: 62 }];
  assert.equal(agreedValue(wells, 'celsius', 1), null);
  assert.equal(agreedValue([{ celsius: 48 }, { celsius: 48.5 }], 'celsius', 1), 48,
    'within tolerance, the published figure is taken -- not a computed midpoint');
  assert.equal(agreedValue([{ celsius: null }, { celsius: null }], 'celsius', 1), null);
});

test('a group whose wells were printed in different units has no panel', () => {
  assert.equal(agreedUnit([{ unit: 'mg/kg' }, { unit: 'mg/l' }]), null);
  assert.equal(agreedUnit([{ unit: 'mg/kg' }, { unit: 'mg/kg' }]), 'mg/kg');
  assert.equal(agreedUnit([{ unit: null }]), null);
});

test('the group year is the most recent one any well states', () => {
  assert.equal(agreedYear([{ measuredAt: '1975' }, { measuredAt: '1991' }]), '1991');
  assert.equal(agreedYear([{ measuredAt: null }]), null);
});

test('the positional gate is the same 200 m NCEI uses', () => {
  // Two upstreams, one positional standard. A looser gate here would mean the
  // project holds different evidence bars for different countries.
  assert.equal(AIST_RADIUS_M, 200);
});

test('the mirror decodes to Japanese, not to mojibake', () => {
  // The encoding trap, pinned. Decoding Shift_JIS as UTF-8 produces a file
  // that still parses as a CSV and still has 82 columns, so the failure does
  // not look like a bad decode -- it looks like every name disagreeing.
  const tsv = fs.readFileSync('data/reference/aist-onsen.tsv', 'utf8');
  assert.ok(!tsv.includes('�'), 'the mirror must contain no replacement characters');
  const rows = fromTsv(tsv);
  assert.equal(rows.length, 7203);
  assert.ok(
    rows.some((r) => /[぀-ヿ一-鿿]/.test(r.onsenName ?? '')),
    'onsen names must be Japanese text',
  );
  assert.deepEqual(Object.keys(rows[0]), TSV_COLUMNS);
});

test('every AIST-enriched record states the unit its figures are in', () => {
  // The defect this stage shipped in its first cut: a chloride reading landed
  // with unit null, because the unit was decided after the figures rather
  // than before them. minerals.unit exists precisely to stop that.
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const aist = all.filter((s) => s.quality.provenance.includes('aist'));
  assert.ok(aist.length > 20, 'not vacuous: the upstream really did enrich records');
  const united = ['tds', 'sulfate', 'bicarbonate', 'chloride', 'calcium',
    'magnesium', 'sodium', 'silica', 'iron'];
  const bare = aist.filter((s) => united.some((k) => typeof s.minerals[k] === 'number')
    && !s.minerals.unit);
  assert.deepEqual(bare.map((s) => s.id), []);
});

test('AIST never writes a coordinate, only reads one', () => {
  // The privacy line. Every published cell is 187-191 m across, so a centroid
  // written to location would invent a precision the source refused to give.
  const source = fs.readFileSync('scripts/build-dataset.mjs', 'utf8');
  const stage = source.slice(source.indexOf('Merging AIST hot spring analyses'),
    source.indexOf('--- Curated overlay ---'));
  assert.ok(stage.length > 0, 'the AIST stage must exist');
  assert.ok(!/\.location\s*=/.test(stage), 'the stage must not assign a location');
  assert.ok(!/location\.(lat|lng)\s*=/.test(stage), 'the stage must not assign coordinates');
  assert.ok(!/records\.push|records\s*=\s*\[/.test(stage), 'enrichment must not add records');
});

test('AIST runs after identity and before the curated overlay', () => {
  const source = fs.readFileSync('scripts/build-dataset.mjs', 'utf8');
  const identity = source.indexOf('resolveRegistry(');
  const aist = source.indexOf('matchAist(');
  const overlay = source.indexOf('applyOverlays(');
  const privacy = source.indexOf('isExcluded(');
  assert.ok(identity > 0 && aist > identity, 'ids must be final before AIST writes to them');
  assert.ok(overlay > aist, 'an authored claim must still beat the upstream');
  assert.ok(privacy > aist, 'the privacy filter still runs last');
});

test('the mirror reads the same whether git checked it out LF or CRLF', () => {
  // It is a COMMITTED file, so git hands it back with CRLF on Windows.
  // Splitting on a bare newline welded a carriage return to the last column
  // NAME, so the parsed row carried a silica key nobody could look up: every
  // silica reading was absent, and nothing errored. The build that produced
  // the committed dataset ran before the first checkout, so the two agreed
  // there and would have disagreed on the next machine to rebuild.
  const lf = ['a\tb\tsilica', '1\t2\t3', ''].join('\n');
  const crlf = ['a\tb\tsilica', '1\t2\t3', ''].join('\r\n');
  assert.deepEqual(Object.keys(fromTsv(lf)[0]), ['a', 'b', 'silica']);
  assert.deepEqual(Object.keys(fromTsv(crlf)[0]), ['a', 'b', 'silica']);
  assert.deepEqual(fromTsv(lf), fromTsv(crlf));
});

test('every measurement column survives the mirror round trip as a number', () => {
  // TSV_NUMERIC used to be a second hand-kept copy of the column list, and the
  // two drifted the first time a column was added. `potassium` reached
  // TSV_COLUMNS, was written to the mirror correctly, and came back as the
  // STRING "23.800" -- not `typeof v === 'number'`, so every agreement check
  // skipped it and the field published nothing. No error, no NaN, just a
  // panel quietly missing one constituent.
  const rows = fromTsv(fs.readFileSync('data/reference/aist-onsen.tsv', 'utf8'));
  // Imported, not restated. A third copy of this list is how the second one
  // drifted, and this test exists because of that drift.
  const TEXT = TSV_TEXT;
  for (const col of TSV_COLUMNS) {
    const stated = rows.filter((r) => r[col] !== null);
    assert.ok(stated.length > 0, `${col} is empty in the mirror`);
    const wrongType = stated.filter((r) => (TEXT.has(col)
      ? typeof r[col] !== 'string'
      : typeof r[col] !== 'number' || Number.isNaN(r[col])));
    assert.deepEqual(
      wrongType.slice(0, 3).map((r) => r[col]),
      [],
      `${col} should parse back as ${TEXT.has(col) ? 'text' : 'a number'}`,
    );
  }
});

test('potassium is read from the K column, not the one beside it', () => {
  // Column 21 sits between Na (20) and NH4 (22). An off-by-one here would
  // publish ammonium as potassium, and both are plausible small numbers, so
  // nothing downstream would look wrong.
  const rows = fromTsv(fs.readFileSync('data/reference/aist-onsen.tsv', 'utf8'));
  assert.equal(rows.filter((r) => typeof r.potassium === 'number').length, 6842);
  // The first row of the published file: Na 334.5, K 23.8.
  assert.equal(rows[0].sodium, 334.5);
  assert.equal(rows[0].potassium, 23.8);
});
