import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CLAIMABLE, AGENT_CLAIMABLE, ARRAY_FIELDS, FIELD_TYPES, RISK, validateOverlay, loadOverlays,
} from './lib/overlay.mjs';

const ID = 'whs_a1b2c3d4e5f6';

const claim = (extra = {}) => ({
  value: 38,
  source: 'https://example.org/survey',
  contributor: 'github:someone',
  state: 'active',
  ...extra,
});

test('the claimable allowlist excludes pipeline-owned fields', () => {
  for (const forbidden of [
    'id', 'unicorn', 'verified', 'sources', 'location.lat', 'location.lng',
    'type', 'temperature.source', 'temperature.measuredAt',
  ]) {
    assert.ok(!CLAIMABLE.includes(forbidden), `${forbidden} must not be claimable`);
  }
});

test('type is not claimable because it drives a safety warning and the quality score', () => {
  assert.ok(!CLAIMABLE.includes('type'));
});

test('every claimable field carries exactly one risk tier', () => {
  for (const field of CLAIMABLE) {
    const tiers = ['low', 'elevated', 'high'].filter((t) => RISK[t].includes(field));
    assert.equal(tiers.length, 1, `${field} should be in exactly one tier, found ${tiers.length}`);
  }
});

test('no risk tier lists a field that is not claimable', () => {
  for (const tier of ['low', 'elevated', 'high']) {
    for (const field of RISK[tier]) {
      assert.ok(CLAIMABLE.includes(field), `RISK.${tier} lists un-claimable ${field}`);
    }
  }
});

test('risk tiers track harm: temperature and clothing are high, name is not', () => {
  assert.ok(RISK.high.includes('temperature.celsius'));
  assert.ok(RISK.high.includes('clothing.policy'));
  assert.ok(RISK.high.includes('warnings'));
  assert.ok(RISK.elevated.includes('name'), 'a wrong name misleads; it does not injure');
  assert.ok(RISK.low.includes('hours.open'));
});

test('validateOverlay accepts a well-formed file', () => {
  assert.deepEqual(validateOverlay({ id: ID, claims: { 'temperature.celsius': claim() } }), []);
});

test('validateOverlay rejects a non-claimable field', () => {
  const errors = validateOverlay({ id: ID, claims: { type: claim({ value: 'resort' }) } });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not claimable/);
});

test('validateOverlay requires a source on every claim', () => {
  const c = claim();
  delete c.source;
  assert.match(validateOverlay({ id: ID, claims: { 'temperature.celsius': c } }).join(), /source/);
});

test('validateOverlay requires a contributor on every claim', () => {
  const c = claim();
  delete c.contributor;
  assert.match(
    validateOverlay({ id: ID, claims: { 'temperature.celsius': c } }).join(),
    /contributor/,
  );
});

test('validateOverlay rejects an out-of-range or non-numeric temperature', () => {
  for (const bad of [318, -40, '38', null, NaN]) {
    assert.match(
      validateOverlay({ id: ID, claims: { 'temperature.celsius': claim({ value: bad }) } }).join(),
      /between -5 and 130/,
      `${JSON.stringify(bad)} should be rejected`,
    );
  }
});

test('FIELD_TYPES declares what src/lib/types.ts declares', () => {
  // Written from the type declarations and the built dataset, not from
  // memory. `access.price` is `string | null` and holds 878 strings, one of
  // which is "Free"; the other two are `number | null`. The last time this
  // mapping was recalled rather than checked, enrich.mjs spent a run refusing
  // every correct price a proposer returned.
  assert.deepEqual(FIELD_TYPES, {
    'temperature.celsius': 'number',
    'location.elevation': 'number',
    'access.price': 'string',
    'clothing.policy': ['optional', 'required', 'textile-only', 'mixed', 'unknown'],
    'hours.status': ['open', 'seasonal', 'closed', 'unknown'],
    tags: 'string[]',
    warnings: 'string[]',
    // Water chemistry, mg/L except ph. Numbers on purpose: a number is the
    // one claim shape verify-claims.mjs can check literally against the page
    // that states it, and published analyses give figures, not prose.
    'minerals.ph': 'number',
    'minerals.tds': 'number',
    'minerals.sulfate': 'number',
    'minerals.bicarbonate': 'number',
    'minerals.chloride': 'number',
    'minerals.calcium': 'number',
    'minerals.magnesium': 'number',
    'minerals.sodium': 'number',
    'minerals.silica': 'number',
    'minerals.iron': 'number',
    'minerals.types': [
      'simple', 'chloride', 'bicarbonate', 'sulfate', 'carbon-dioxide',
      'iron', 'acidic', 'iodine', 'sulfur', 'radioactive', 'aluminium',
    ],
    'minerals.notes': 'string',
    'minerals.measuredAt': 'string',
  });
  for (const field of Object.keys(FIELD_TYPES)) {
    assert.ok(CLAIMABLE.includes(field), `${field} must be claimable to be type-checked`);
  }
});

test('validateOverlay rejects a non-numeric elevation', () => {
  // The gap this closes: a string elevation validated cleanly, so "3300"
  // could have been published into a field the UI reads as a number.
  for (const bad of ['3300', '', null, true, [3300], { m: 3300 }, NaN, Infinity]) {
    assert.match(
      validateOverlay({ id: ID, claims: { 'location.elevation': claim({ value: bad }) } }).join(),
      /location\.elevation: value must be a number/,
      `${JSON.stringify(bad)} should be rejected as an elevation`,
    );
  }
  assert.deepEqual(
    validateOverlay({ id: ID, claims: { 'location.elevation': claim({ value: 3300 }) } }),
    [],
  );
});

test('validateOverlay rejects a non-string price', () => {
  // A number here would render as a bare "19.75" with no currency and no
  // "Free" -- format.ts prints access.price as text, unmodified.
  for (const bad of [19.75, 0, null, true, ['$19.75'], { usd: 19.75 }]) {
    assert.match(
      validateOverlay({ id: ID, claims: { 'access.price': claim({ value: bad }) } }).join(),
      /access\.price: value must be a string/,
      `${JSON.stringify(bad)} should be rejected as a price`,
    );
  }
});

test('the price strings on the five open pull requests validate', () => {
  // Verbatim from the open contributions. This fix exists to make the agent
  // path agree with these; breaking them would invert the whole point.
  for (const price of [
    'Adult $19.75',
    'Adults $42-$60 (peak/off-peak vary)',
    'Daily 13,200 Ft (locker)',
    'Day spa from €30 (Parco) / €90 (Club)',
    'Select $43-$75 / Premier (21+) $75-$135',
    'Free',
  ]) {
    assert.deepEqual(
      validateOverlay({ id: ID, claims: { 'access.price': claim({ value: price }) } }),
      [],
      `${price} must validate`,
    );
  }
});

test('validateOverlay rejects a malformed id', () => {
  assert.match(validateOverlay({ id: 'osm-node-1', claims: {} }).join(), /whs_/);
  assert.match(validateOverlay({ id: 'whs_a1b2c3', claims: {} }).join(), /whs_/, '6 hex is not enough');
  assert.match(validateOverlay({ claims: {} }).join(), /whs_/, 'a missing id is an error');
});

test('validateOverlay requires array fields to hold arrays', () => {
  assert.match(
    validateOverlay({ id: ID, claims: { tags: claim({ value: 'sulfur' }) } }).join(),
    /must be an array/,
  );
});

test('validateOverlay rejects a non-string element in tags or warnings', () => {
  // Both fields are merge-only in applyOverlays, so a wrong element can never
  // be removed by a later claim. `[42]` and `[{}]` validated cleanly before.
  for (const field of ['tags', 'warnings']) {
    for (const bad of [[42], [{}], ['ok', null], [undefined], [['nested']], [true]]) {
      assert.match(
        validateOverlay({ id: ID, claims: { [field]: claim({ value: bad }) } }).join(),
        new RegExp(`${field}: every element must be a string`),
        `${field} ${JSON.stringify(bad)} should be rejected`,
      );
    }
    for (const good of [[], ['sulfur'], ['a', 'b']]) {
      assert.deepEqual(
        validateOverlay({ id: ID, claims: { [field]: claim({ value: good }) } }),
        [],
        `${field} ${JSON.stringify(good)} must validate`,
      );
    }
  }
});

test('the element error names the offending index, not just the field', () => {
  assert.match(
    validateOverlay({ id: ID, claims: { warnings: claim({ value: ['fine', 42] }) } }).join(),
    /warnings: every element must be a string, but \[1\] is 42/,
  );
});

test('validateOverlay accepts every ClothingPolicy src/lib/types.ts declares', () => {
  // `mixed` is declared but unused in the built dataset. It must still pass:
  // the type is the contract, not the current contents.
  for (const policy of ['optional', 'required', 'textile-only', 'mixed', 'unknown']) {
    assert.deepEqual(
      validateOverlay({ id: ID, claims: { 'clothing.policy': claim({ value: policy }) } }),
      [],
      `${policy} must validate`,
    );
  }
});

test('validateOverlay rejects an off-enum clothing policy and lists the permitted values', () => {
  // CLOTHING_LABEL in src/lib/format.ts is keyed on the value, so anything
  // off-enum renders blank -- while recomputeCompleteness counts it as known
  // (policy !== 'unknown') and inflates the quality score.
  for (const bad of ['clothes off', 'Optional', 'nude', '', null, 42, ['optional'], undefined]) {
    const errors = validateOverlay({
      id: ID, claims: { 'clothing.policy': claim({ value: bad }) },
    }).join('\n');
    assert.match(
      errors,
      /clothing\.policy: value must be one of optional, required, textile-only, mixed, unknown/,
      `${JSON.stringify(bad)} should be rejected as a clothing policy`,
    );
  }
});

test('validateOverlay accepts every HoursStatus src/lib/types.ts declares', () => {
  for (const status of ['open', 'seasonal', 'closed', 'unknown']) {
    assert.deepEqual(
      validateOverlay({ id: ID, claims: { 'hours.status': claim({ value: status }) } }),
      [],
      `${status} must validate`,
    );
  }
});

test('the hours.status claim on the three open pull requests still validates', () => {
  // Verbatim from the open contributions. A new constraint that rejected these
  // would break merged-ready work to close a gap none of them had.
  assert.deepEqual(
    validateOverlay({ id: ID, claims: { 'hours.status': claim({ value: 'open' }) } }),
    [],
  );
});

test('validateOverlay rejects an off-enum hours status and lists the permitted values', () => {
  // Same shape of bug: HOURS_LABEL is keyed on the value, and
  // `status !== 'unknown'` counts toward completeness.
  for (const bad of ['maybe', 'Open', 'year-round', '', null, 1, ['open'], undefined]) {
    assert.match(
      validateOverlay({ id: ID, claims: { 'hours.status': claim({ value: bad }) } }).join('\n'),
      /hours\.status: value must be one of open, seasonal, closed, unknown/,
      `${JSON.stringify(bad)} should be rejected as an hours status`,
    );
  }
});

test('ARRAY_FIELDS and FIELD_TYPES cannot disagree about which fields are arrays', () => {
  // Divergence, not mechanism: a hand-written ARRAY_FIELDS that happens to
  // match passes this, and should -- what broke enrich.mjs last time was two
  // copies that had drifted apart, not the existence of two copies.
  assert.deepEqual(ARRAY_FIELDS, ['tags', 'warnings']);
  for (const field of ARRAY_FIELDS) {
    assert.equal(FIELD_TYPES[field], 'string[]', `${field} must declare its element type`);
  }
});

function overlayDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whs-overlay-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

test('loadOverlays returns an empty map when the directory does not exist', () => {
  assert.equal(loadOverlays(path.join(os.tmpdir(), 'whs-does-not-exist')).size, 0);
});

test('loadOverlays reads valid files keyed by spring id', () => {
  const dir = overlayDir({ 'a.json': { id: ID, claims: { 'temperature.celsius': claim() } } });
  const overlays = loadOverlays(dir);
  assert.equal(overlays.size, 1);
  assert.equal(overlays.get(ID).claims['temperature.celsius'].value, 38);
});

test('loadOverlays throws on malformed JSON rather than silently skipping it', () => {
  // The same reasoning that makes a malformed exclusion list fatal: degrading
  // to "no claims" would silently discard authored corrections.
  const dir = overlayDir({ 'broken.json': '{ not json' });
  assert.throws(() => loadOverlays(dir), /not valid JSON/);
});

test('loadOverlays throws on an invalid claim rather than skipping the file', () => {
  const dir = overlayDir({ 'bad.json': { id: ID, claims: { type: claim({ value: 'resort' }) } } });
  assert.throws(() => loadOverlays(dir), /not claimable/);
});

test('loadOverlays rejects two files claiming the same spring', () => {
  // Two files for one spring means one of them is silently ignored, and which
  // one depends on directory order.
  const dir = overlayDir({
    'a.json': { id: ID, claims: { 'hours.open': claim({ value: '24/7' }) } },
    'b.json': { id: ID, claims: { 'access.price': claim({ value: 'Free' }) } },
  });
  assert.throws(() => loadOverlays(dir), /already claims/);
});

test('loadOverlays ignores non-JSON files in the directory', () => {
  const dir = overlayDir({
    'a.json': { id: ID, claims: { 'temperature.celsius': claim() } },
    '.gitkeep': '',
    'README.md': '# notes',
  });
  assert.equal(loadOverlays(dir).size, 1);
});

import { applyOverlays } from './lib/overlay.mjs';

function record(over = {}) {
  return {
    id: ID,
    name: 'Reykjadalur',
    location: { lat: 64.048, lng: -21.2222, elevation: null, country: 'IS',
                countryName: 'Iceland', region: null, nearestTown: null },
    temperature: { celsius: null, fahrenheit: null, source: null, measuredAt: null, qualitative: null },
    access: { price: 'Free', currency: null, notes: null },
    clothing: { policy: 'unknown', schedule: null, notes: null },
    hours: { open: '24/7', seasonalNotes: null, status: 'open' },
    type: 'developed',
    unicorn: false,
    verified: false,
    lastVerified: '2026-08-25',
    sources: ['https://www.openstreetmap.org/node/4702109263'],
    description: null,
    tags: ['hot-spring', 'open-air'],
    warnings: [],
    quality: { provenance: ['osm'], completeness: 67, known: [], ingestedAt: '2026-08-25' },
    ...over,
  };
}

const overlay = (claims) => new Map([[ID, { id: ID, claims }]]);

const tempClaim = {
  value: 38, source: 'https://example.org/survey', measuredAt: '2026-03-14',
  contributor: 'github:someone', state: 'active',
};

test('a claim overrides the derived value', () => {
  const { records } = applyOverlays([record()], overlay({ 'temperature.celsius': tempClaim }));
  assert.equal(records[0].temperature.celsius, 38);
});

test('fahrenheit is recomputed from the claimed celsius', () => {
  const { records } = applyOverlays([record()], overlay({ 'temperature.celsius': tempClaim }));
  assert.equal(records[0].temperature.fahrenheit, 100.4);
});

test('temperature provenance is derived from the claim, not claimed separately', () => {
  const { records } = applyOverlays([record()], overlay({ 'temperature.celsius': tempClaim }));
  assert.equal(records[0].temperature.measuredAt, '2026-03-14');
  assert.match(records[0].temperature.source, /example\.org\/survey/);
  assert.match(records[0].temperature.source, /github:someone/);
});

test("the claim's source is appended to the record's sources", () => {
  const { records } = applyOverlays([record()], overlay({ 'temperature.celsius': tempClaim }));
  assert.ok(records[0].sources.includes('https://example.org/survey'));
  assert.ok(records[0].sources.includes('https://www.openstreetmap.org/node/4702109263'));
});

test('unclaimed fields still track upstream', () => {
  const { records } = applyOverlays([record()], overlay({ 'temperature.celsius': tempClaim }));
  assert.equal(records[0].hours.open, '24/7');
  assert.equal(records[0].access.price, 'Free');
});

test('array claims merge and never remove', () => {
  const { records } = applyOverlays(
    [record()],
    overlay({ tags: { value: ['sulfur'], source: 'https://x.test', contributor: 'github:a', state: 'active' } }),
  );
  assert.deepEqual(records[0].tags, ['hot-spring', 'open-air', 'sulfur']);
});

test('a warnings claim cannot strip a derived safety warning', () => {
  const scalding = record({ warnings: ['Scalding: recorded at 50°C or above.'] });
  const { records } = applyOverlays(
    [scalding],
    overlay({ warnings: { value: [], source: 'https://x.test', contributor: 'github:a', state: 'active' } }),
  );
  assert.deepEqual(records[0].warnings, ['Scalding: recorded at 50°C or above.']);
});

test('completeness is recomputed after claims land', () => {
  const before = record().quality.completeness;
  const { records } = applyOverlays([record()], overlay({ 'temperature.celsius': tempClaim }));
  assert.ok(records[0].quality.completeness > before);
  assert.equal(records[0].quality.curated, true);
});

test('a non-active claim is ignored', () => {
  const { records, applied } = applyOverlays(
    [record()],
    overlay({ 'temperature.celsius': { ...tempClaim, state: 'rejected' } }),
  );
  assert.equal(records[0].temperature.celsius, null);
  assert.equal(applied, 0);
});

test('claims for a spring absent from this build are reported, not lost', () => {
  const { applied, orphaned } = applyOverlays([], overlay({ 'temperature.celsius': tempClaim }));
  assert.equal(applied, 0);
  assert.deepEqual(orphaned, [ID]);
});

test('a disagreement with upstream emits a contested event', () => {
  const upstream = record({
    temperature: { celsius: 42, fahrenheit: 107.6, source: 'OSM', measuredAt: null, qualitative: null },
  });
  const { events, records } = applyOverlays([upstream], overlay({ 'temperature.celsius': tempClaim }));
  const contested = events.filter((e) => e.type === 'claim.contested');
  assert.equal(contested.length, 1);
  assert.equal(contested[0].from, 42);
  assert.equal(contested[0].to, 38);
  assert.equal(contested[0].claimPath, 'temperature.celsius');
  assert.equal(records[0].temperature.celsius, 38, 'the curated value keeps rendering while contested');
});

test('agreement within tolerance is not contested', () => {
  const upstream = record({
    temperature: { celsius: 38.2, fahrenheit: 100.8, source: 'OSM', measuredAt: null, qualitative: null },
  });
  const { events } = applyOverlays([upstream], overlay({ 'temperature.celsius': tempClaim }));
  assert.equal(events.filter((e) => e.type === 'claim.contested').length, 0);
});

test('a difference just past tolerance is contested', () => {
  const upstream = record({
    temperature: { celsius: 38.6, fahrenheit: 101.5, source: 'OSM', measuredAt: null, qualitative: null },
  });
  const { events } = applyOverlays([upstream], overlay({ 'temperature.celsius': tempClaim }));
  assert.equal(events.filter((e) => e.type === 'claim.contested').length, 1, '0.6C exceeds 0.5C slack');
});

test('a null upstream value is absence, not disagreement', () => {
  const { events } = applyOverlays([record()], overlay({ 'temperature.celsius': tempClaim }));
  assert.equal(events.filter((e) => e.type === 'claim.contested').length, 0);
});

test('string fields are contested on any difference', () => {
  const upstream = record({ hours: { open: 'Mo-Fr 09:00-17:00', seasonalNotes: null, status: 'open' } });
  const { events } = applyOverlays(
    [upstream],
    overlay({ 'hours.open': { value: '24/7', source: 'https://x.test', contributor: 'github:a', state: 'active' } }),
  );
  assert.equal(events.filter((e) => e.type === 'claim.contested').length, 1);
});

test('array fields never contest, because they merge', () => {
  const { events } = applyOverlays(
    [record()],
    overlay({ tags: { value: ['sulfur'], source: 'https://x.test', contributor: 'github:a', state: 'active' } }),
  );
  assert.equal(events.filter((e) => e.type === 'claim.contested').length, 0);
});

test('an overlay for a nonexistent spring id is rejected', () => {
  const known = new Set(['whs_b803e624c229']);
  const errors = validateOverlay(
    { id: 'whs_000000000000', claims: {} },
    { knownIds: known },
  );
  assert.ok(
    errors.some((e) => /not a spring in this dataset/.test(e)),
    'a well-formed id that matches nothing must be rejected',
  );
});

test('a known spring id passes the existence check', () => {
  const known = new Set(['whs_b803e624c229']);
  assert.deepEqual(validateOverlay({ id: 'whs_b803e624c229', claims: {} }, { knownIds: known }), []);
});

test('the existence check is skipped when no id set is supplied', () => {
  // Back-compat: every existing caller passes one argument.
  assert.deepEqual(validateOverlay({ id: 'whs_000000000000', claims: {} }), []);
});

test('AGENT_CLAIMABLE withholds exactly the four human-only fields', () => {
  assert.deepEqual(
    CLAIMABLE.filter((f) => !AGENT_CLAIMABLE.includes(f)).sort(),
    ['location.nearestTown', 'name', 'tags', 'warnings'].sort(),
  );
  // 13 original + 13 mineral fields. The withheld four are unchanged: water
  // chemistry is claimable by an agent because every numeric part of it is
  // literally checkable against the cited analysis, which is a stronger
  // guarantee than any field on the original list except temperature.
  assert.equal(AGENT_CLAIMABLE.length, 26);
});

test('an agent may claim every permitted field', () => {
  // Each value is shaped by the field's declared constraint. It used to be 'x'
  // for everything but temperature, which passed only because nothing checked
  // the elevation's type -- and later, the two enums.
  const shaped = (f) => {
    const t = FIELD_TYPES[f];
    if (Array.isArray(t)) return t[0];
    if (t === 'string[]') return [];
    return t === 'number' ? 40 : 'x';
  };
  const claims = Object.fromEntries(AGENT_CLAIMABLE.map((f) => [f, {
    value: shaped(f),
    source: 'https://e.org',
    contributor: 'openai:gpt-5',
  }]));
  assert.deepEqual(validateOverlay({ id: 'whs_b803e624c229', claims }, { agentAuthored: true }), []);
});

test('an agent claim on a human-only field is rejected', () => {
  const errors = validateOverlay(
    {
      id: 'whs_b803e624c229',
      claims: {
        'location.nearestTown': { value: 'Springfield', source: 'https://e.org', contributor: 'openai:gpt-5' },
      },
    },
    { agentAuthored: true },
  );
  assert.ok(errors.some((e) => /not claimable by an agent/.test(e)));
});

test('the same field is accepted from a human author', () => {
  const errors = validateOverlay({
    id: 'whs_b803e624c229',
    claims: {
      'location.nearestTown': { value: 'Springfield', source: 'https://e.org', contributor: 'github:someone' },
    },
  });
  assert.deepEqual(errors, []);
});
