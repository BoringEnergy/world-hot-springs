/**
 * The detail card's display model.
 *
 * Layer B of the frontend-test plan: the card's decisions are functions of a
 * HotSpring, so they are testable with the runner this repository already has.
 * No React, no DOM, no second stack, nothing that needs `npm ci` on Gate 2 --
 * Node imports the TypeScript directly by stripping its types.
 *
 * These exist because the two worst display bugs this project has shipped
 * were both MODEL bugs wearing a rendering costume, and both were found by
 * eye rather than by a test:
 *
 *   the blank page    an optional key present-but-undefined is not an absent
 *                     key, and the difference is invisible in markup
 *   the bare figures  Radium rendered "Sulfate 302" under a hardcoded mg/L
 *                     while its source said mg/l
 *
 * The fixtures are REAL records, committed, chosen to cover the shapes that
 * have actually broken. Synthetic records would drift from what ships.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  mineralRows, mineralsFootnote, temperatureDisplay, prohibitionNotice, UNKNOWN,
} from '../src/lib/format.ts';

const F = JSON.parse(fs.readFileSync('scripts/fixtures/cards.json', 'utf8'));

test('the fixtures are real records that still exist', () => {
  // A fixture that has drifted from the dataset tests a card nobody sees.
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const byId = new Map(all.map((s) => [s.id, s]));
  for (const [name, fixture] of Object.entries(F)) {
    const live = byId.get(fixture.id);
    assert.ok(live, `fixture ${name} (${fixture.id}) is no longer in the dataset`);
    assert.deepEqual(live.temperature, fixture.temperature, `fixture ${name} has drifted`);
    assert.deepEqual(live.minerals, fixture.minerals, `fixture ${name} has drifted`);
  }
});

test('a mineral figure carries the unit its source named', () => {
  // The bug this function exists for. Radium publishes mg/l and the card
  // hardcoded mg/L for everyone.
  const rows = mineralRows(F.radium.minerals);
  assert.equal(rows.find((r) => r.key === 'sulfate').value, '302 mg/L');
  const aist = mineralRows(F.aistTyped.minerals);
  assert.equal(aist.find((r) => r.key === 'sodium').value, '110.8 mg/kg');
});

test('pH never takes the panel unit', () => {
  // It is unitless. Appending mg/kg to it would be a units error on the field
  // people read for skin safety.
  const rows = mineralRows(F.aistTyped.minerals);
  const ph = rows.find((r) => r.key === 'ph');
  assert.equal(ph.value, '7.9');
  assert.ok(!ph.value.includes('mg'));
  assert.equal(rows[0].key, 'ph', 'pH leads the panel');
});

test('a figure with no stated unit renders bare, and the footnote says so', () => {
  // Constructed, not drawn from the dataset: a guard added with minerals.unit
  // asserts no shipped record states figures without naming a unit. The
  // function still has to handle it, because that guard is what would fail.
  const noUnit = { ...F.radium.minerals, unit: null };
  assert.equal(mineralRows(noUnit).find((r) => r.key === 'sulfate').value, '302');
  assert.match(mineralsFootnote(noUnit), /does not state what unit/);
  assert.doesNotMatch(mineralsFootnote(F.radium.minerals), /does not state what unit/);
});

test('a pH-only panel is not told its unit is missing', () => {
  // pH needs no unit, so "the source does not state what unit" would be a
  // complaint about nothing.
  const phOnly = {
    ...F.radium.minerals,
    unit: null,
    ph: 7.2,
    tds: null,
    sulfate: null,
    bicarbonate: null,
    chloride: null,
    calcium: null,
    magnesium: null,
    sodium: null,
    potassium: null,
    silica: null,
    iron: null,
  };
  assert.doesNotMatch(mineralsFootnote(phOnly), /does not state what unit/);
});

test('the disclaimer is unconditional', () => {
  // Every path, dated or not, united or not. A panel rendered bare reads as a
  // measurement somebody took for you.
  const cases = [
    F.radium.minerals,
    F.aistTyped.minerals,
    { ...F.radium.minerals, measuredAt: null },
  ];
  for (const m of cases) {
    assert.match(mineralsFootnote(m), /does not test water/);
    assert.match(mineralsFootnote(m), /not verified these figures on site/);
  }
});

test('an undated analysis says so rather than implying freshness', () => {
  assert.match(mineralsFootnote(F.aistTyped.minerals), /^Analysed 1998 /);
  assert.match(
    mineralsFootnote({ ...F.radium.minerals, measuredAt: null }),
    /without stating when the water was analysed/,
  );
});

test('a temperature shows both units so the conversion is checkable', () => {
  const c = temperatureDisplay(F.bathingKind, 'c');
  assert.equal(c.primary, '32°C');
  assert.equal(c.secondary, '89.6°F');
  const f = temperatureDisplay(F.bathingKind, 'f');
  assert.equal(f.primary, '89.6°F');
  assert.equal(f.secondary, '32°C');
});

test('which water a reading describes is labelled, except when unknown', () => {
  // A spa whose spring rises at 24.6C and heats its pools reads as a tepid
  // bath without this; a 110C source reads as a bath you could get into.
  assert.equal(temperatureDisplay(F.sourceKind, 'c').kind, 'at source');
  assert.equal(temperatureDisplay(F.bathingKind, 'c').kind, 'bathing water');
  // The majority case renders nothing rather than the word "unknown".
  assert.equal(temperatureDisplay(F.prohibited, 'c').kind, null);
});

test('a spring with no reading says Unknown, and shows its qualitative word alone', () => {
  const d = temperatureDisplay(F.noTemp, 'c');
  assert.equal(d.primary, UNKNOWN);
  assert.equal(d.secondary, null, 'there is no second unit for a number that does not exist');
  assert.equal(d.qualitative, `described as ${F.noTemp.temperature.qualitative}`);
  assert.equal(d.kind, null, 'a kind label on no number describes nothing');
});

test('a qualitative word is not shown beside a real number', () => {
  // Noise next to a figure; the only thing the source said when there is none.
  const withBoth = {
    ...F.noTemp,
    temperature: { ...F.noTemp.temperature, celsius: 40, fahrenheit: 104 },
  };
  assert.equal(temperatureDisplay(withBoth, 'c').qualitative, null);
});

test('a bare record shows nothing it does not know', () => {
  const d = temperatureDisplay(F.bare, 'c');
  assert.equal(d.primary, UNKNOWN);
  assert.equal(d.secondary, null);
  assert.equal(d.qualitative, null);
  assert.equal(d.measuredAt, null);
  assert.equal(d.kind, null);
});

test('the prohibition notice is keyed on bathingAllowed === false, not on falsiness', () => {
  // null means nobody has said. Treating it as false would put a "do not
  // enter the water" banner on most of the atlas; treating false as null
  // would take it off springs that have killed people.
  assert.equal(prohibitionNotice(F.prohibited).prohibited, true);
  assert.match(prohibitionNotice(F.prohibited).text, /Bathing is not permitted here/);
  assert.equal(prohibitionNotice(F.radium).prohibited, false);
  assert.equal(prohibitionNotice(F.bare).prohibited, false);
  const undef = { ...F.bare, access: { ...F.bare.access, bathingAllowed: undefined } };
  assert.equal(prohibitionNotice(undef).prohibited, false, 'undefined is not false');
});
