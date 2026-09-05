/**
 * Water chemistry: the schema, and the disclaimer that must travel with it.
 *
 * The disclaimer is not decoration. A mineral panel rendered bare reads as a
 * measurement somebody took for you, and this atlas has never tested water.
 * So the card is required to say so, and that requirement is checked rather
 * than trusted to survive the next layout edit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FIELD_TYPES, CLAIMABLE, AGENT_CLAIMABLE, RISK, validateOverlay } from './lib/overlay.mjs';
import { NUMERIC_FIELDS, LITERAL_FIELDS } from './enrich.mjs';

const PANEL = fs.readFileSync('src/components/DetailPanel.tsx', 'utf8');
const TYPES = fs.readFileSync('src/lib/types.ts', 'utf8');
const MINERAL_FIELDS = CLAIMABLE.filter((f) => f.startsWith('minerals.'));

test('every mineral concentration is a number, so it can be verified literally', () => {
  // The reason the schema is shaped this way. A published analysis states
  // "Sulphate (302 mg/l)", so 302 appears verbatim on the page and
  // verify-claims.mjs can check it without a model. Storing the panel as
  // prose would have made every mineral claim unverifiable.
  const numeric = MINERAL_FIELDS.filter((f) => FIELD_TYPES[f] === 'number');
  assert.equal(numeric.length, 10, 'ph, tds and the eight constituents');
  for (const f of numeric) {
    assert.ok(LITERAL_FIELDS.includes(f), `${f} must be fetch-checkable`);
    assert.ok(NUMERIC_FIELDS.includes(f), `${f} must be in NUMERIC_FIELDS`);
  }
});

test('pH is a high-risk field, like temperature', () => {
  // Onsen exist at pH 1.5. A wrong pH sends someone with the wrong skin, or
  // the wrong eyes, into acid -- the same class of harm the high tier is for.
  assert.ok(RISK.high.includes('minerals.ph'));
  assert.ok(RISK.high.includes('minerals.types'), 'acidic and radioactive are members');
});

test('every mineral field carries exactly one risk tier', () => {
  for (const f of MINERAL_FIELDS) {
    const tiers = Object.entries(RISK).filter(([, fields]) => fields.includes(f));
    assert.equal(tiers.length, 1, `${f} must have exactly one tier, has ${tiers.length}`);
  }
});

test('an agent may claim water chemistry', () => {
  // Deliberate: every numeric part is literally checkable against the cited
  // analysis, which is a stronger guarantee than any field on the original
  // list except temperature.
  for (const f of MINERAL_FIELDS) {
    assert.ok(AGENT_CLAIMABLE.includes(f), `${f} should be agent-claimable`);
  }
});

test('the classification vocabulary is the Hot Spring Law one', () => {
  // Adopted, not invented: an invented vocabulary would have no sources
  // behind it. Legally required to be posted in Japan, where 778 of these
  // springs are.
  assert.deepEqual(FIELD_TYPES['minerals.types'], [
    'simple', 'chloride', 'bicarbonate', 'sulfate', 'carbon-dioxide',
    'iron', 'acidic', 'iodine', 'sulfur', 'radioactive', 'aluminium',
  ]);
  assert.ok(TYPES.includes('export type MineralType'));
});

test('a claim outside the vocabulary is rejected', () => {
  const errors = validateOverlay(
    {
      id: 'whs_000000000001',
      claims: {
        'minerals.types': {
          value: ['definitely-not-a-category'],
          source: 'https://example.com/analysis',
          contributor: 'agent',
          state: 'active',
        },
      },
    },
    { knownIds: new Set(['whs_000000000001']) },
  );
  assert.ok(errors.length > 0, 'an invented category must not validate');
});

test('a non-numeric concentration is rejected', () => {
  // "302 mg/l" as a string would reach the UI and render beside real numbers.
  const errors = validateOverlay(
    {
      id: 'whs_000000000001',
      claims: {
        'minerals.sulfate': {
          value: '302 mg/l',
          source: 'https://example.com/analysis',
          contributor: 'agent',
          state: 'active',
        },
      },
    },
    { knownIds: new Set(['whs_000000000001']) },
  );
  assert.ok(errors.some((e) => e.includes('minerals.sulfate')), JSON.stringify(errors));
});

test('the detail card states that this atlas does not test water', () => {
  // The standing disclaimer. Unconditional, not gated on measuredAt: the
  // figures are transcribed from a source in every case.
  assert.ok(
    PANEL.includes('does not test water'),
    'the composition section must say the atlas does not test water',
  );
  assert.ok(
    PANEL.includes('not verified these figures on site'),
    'and that it has not verified them on site',
  );
});

test('an undated analysis says so rather than implying freshness', () => {
  // Chemistry drifts, and an undated analysis may be decades old. "Analysed
  // <date>" and "the source does not say when" are different things to act
  // on, so the card must not collapse them.
  assert.ok(PANEL.includes('without stating when the water was analysed'));
  assert.ok(PANEL.includes('measuredAt'), 'the distinction must be data-driven');
});

test('every record carries a minerals block, present and empty', () => {
  // A field that only existed once something claimed it would make
  // `spring.minerals.ph` throw on the 6,400 springs nobody has analysed.
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const missing = all.filter((r) => !r.minerals || !Array.isArray(r.minerals.types));
  assert.equal(missing.length, 0, `${missing.length} records lack a minerals block`);
});

test('the published Radium analysis survives the round trip', () => {
  // End to end against a real source: Parks Canada publishes "Sulphate (302
  // mg/l), Calcium (135 mg/l), Bicarbonate (100.8 mg/l), Silica (31.8 mg/l),
  // and Magnesium (31.6 mg/l)", and all five verify literally against that
  // page. This asserts the numbers reached the built dataset.
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const radium = all.find((r) => r.id === 'whs_ce8611720825');
  assert.ok(radium, 'Radium Hot Springs should be in the dataset');
  assert.equal(radium.minerals.sulfate, 302);
  assert.equal(radium.minerals.calcium, 135);
  assert.equal(radium.minerals.bicarbonate, 100.8);
  assert.equal(radium.minerals.silica, 31.8);
  assert.equal(radium.minerals.magnesium, 31.6);
  // Not claimed, and therefore still null -- the panel is partial and the
  // record says so instead of filling gaps.
  assert.equal(radium.minerals.ph, null);
  assert.equal(radium.minerals.sodium, null);
});
