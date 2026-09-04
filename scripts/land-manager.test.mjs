import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadLandManagers,
  matchingManagers,
  applyLandManagers,
  LAND_MANAGERS_FILE,
} from './lib/land-manager.mjs';
import { applyOverlays } from './lib/overlay.mjs';
import { parseAccess } from './lib/normalize.mjs';

/**
 * How many shipped springs the layer actually touches. Pinned, because every
 * other test in this file uses synthetic records: a bbox typo that matched
 * nothing real would leave them all green.
 */
const EXPECTED_COVERED = 1289;

const YELLOWSTONE = {
  id: 'us-nps-yellowstone',
  name: 'Yellowstone National Park',
  manager: 'US National Park Service',
  bbox: [-111.156, 44.132, -109.816, 45.102],
  access: { status: 'view-only', bathingAllowed: false },
  warning: 'Entering or soaking in thermal features is prohibited.',
  source: 'https://www.nps.gov/yell/planyourvisit/safety.htm',
  retrievedAt: '2026-09-03',
};

/** Abyss Pool, West Thumb: inside the park, named, previously warning-free. */
function inside(over = {}) {
  return {
    id: 'whs_000000000001',
    name: 'Abyss Pool',
    location: { lat: 44.4165, lng: -110.5735 },
    type: 'natural',
    access: { price: null, currency: null, notes: null, status: 'unknown', bathingAllowed: null },
    warnings: [],
    tags: [],
    temperature: { celsius: null, fahrenheit: null, source: null, measuredAt: null, qualitative: null },
    clothing: { policy: 'unknown', schedule: null, notes: null },
    hours: { open: null, seasonalNotes: null, status: 'unknown' },
    sources: ['https://www.openstreetmap.org/node/1'],
    quality: { provenance: ['osm'], completeness: 0, known: [], ingestedAt: '2026-01-01' },
    ...over,
  };
}

/** Chico Hot Springs, Montana: north of the park boundary, legal to soak in. */
function outside(over = {}) {
  return {
    id: 'whs_000000000002',
    name: 'Chico Hot Springs',
    location: { lat: 45.3428, lng: -110.7053 },
    type: 'developed',
    access: { price: '$10', currency: null, notes: null, status: 'unknown', bathingAllowed: null },
    warnings: [],
    tags: [],
    temperature: { celsius: null, fahrenheit: null, source: null, measuredAt: null, qualitative: null },
    clothing: { policy: 'unknown', schedule: null, notes: null },
    hours: { open: null, seasonalNotes: null, status: 'unknown' },
    sources: ['https://www.openstreetmap.org/node/1'],
    quality: { provenance: ['osm'], completeness: 0, known: [], ingestedAt: '2026-01-01' },
    ...over,
  };
}

test('a spring inside the bbox gets the status, the flag and the warning', () => {
  const r = inside();
  const { applied } = applyLandManagers([r], [YELLOWSTONE]);
  assert.equal(applied, 1);
  assert.equal(r.access.status, 'view-only');
  assert.equal(r.access.bathingAllowed, false);
  assert.deepEqual(r.warnings, [YELLOWSTONE.warning]);
});

test('a spring outside the bbox gets none of it', () => {
  const r = outside();
  const { applied } = applyLandManagers([r], [YELLOWSTONE]);
  assert.equal(applied, 0);
  assert.equal(r.access.status, 'unknown');
  assert.equal(r.access.bathingAllowed, null);
  assert.deepEqual(r.warnings, []);
});

test('each bbox edge is tested independently, so a swapped corner is caught', () => {
  // Four near-misses, one per side. A containment test that mixed up which
  // bbox component bounds which axis would let at least one of these through.
  const [minLng, minLat, maxLng, maxLat] = YELLOWSTONE.bbox;
  const misses = [
    { lat: 44.5, lng: minLng - 0.01, why: 'west of the park' },
    { lat: 44.5, lng: maxLng + 0.01, why: 'east of the park' },
    { lat: minLat - 0.01, lng: -110.5, why: 'south of the park' },
    { lat: maxLat + 0.01, lng: -110.5, why: 'north of the park' },
  ];
  for (const m of misses) {
    assert.equal(
      matchingManagers({ location: m }, [YELLOWSTONE]).length,
      0,
      `${m.why} must not match`,
    );
  }
  assert.equal(matchingManagers({ location: { lat: 44.5, lng: -110.5 } }, [YELLOWSTONE]).length, 1);
});

test('an authored claim that bathing is allowed is overridden', () => {
  // The safety property the stage ordering exists for: overlays run first, the
  // land manager runs after, so no contributor claim can unlock a closed park.
  const r = inside();
  const overlays = new Map([[
    r.id,
    {
      id: r.id,
      claims: {
        warnings: {
          value: ['Lovely soak, bring a towel.'],
          source: 'https://example.org/blog',
          contributor: 'github:optimist',
          state: 'active',
        },
      },
    },
  ]]);
  applyOverlays([r], overlays);
  // access.status and access.bathingAllowed are not in CLAIMABLE, so an
  // overlay cannot name them. Set them directly: the strongest possible
  // authored assertion, and the land manager must still win.
  r.access.bathingAllowed = true;
  r.access.status = 'public';

  applyLandManagers([r], [YELLOWSTONE]);
  assert.equal(r.access.bathingAllowed, false, 'the land manager must win');
  assert.equal(r.access.status, 'view-only');
  assert.ok(r.warnings.includes(YELLOWSTONE.warning));
  assert.ok(
    r.warnings.includes('Lovely soak, bring a towel.'),
    'the authored warning is kept, not replaced: this stage only adds',
  );
});

test('applying twice does not duplicate the warning', () => {
  // The build is byte-reproducible only if this stage is idempotent.
  const r = inside();
  applyLandManagers([r], [YELLOWSTONE]);
  const first = structuredClone(r);
  applyLandManagers([r], [YELLOWSTONE]);
  assert.deepEqual(r, first);
});

test('the stage never adds, removes or reorders records', () => {
  const records = [inside(), outside()];
  const ids = records.map((r) => r.id);
  const { records: out } = applyLandManagers(records, [YELLOWSTONE]);
  assert.equal(out, records, 'records are modified in place, not rebuilt');
  assert.deepEqual(out.map((r) => r.id), ids);
});

test('the most restrictive of two overlapping managers wins', () => {
  const permissive = {
    ...YELLOWSTONE,
    id: 'a',
    access: { status: 'permit', bathingAllowed: true },
    warning: 'Permit required.',
  };
  const closed = {
    ...YELLOWSTONE,
    id: 'b',
    access: { status: 'closed', bathingAllowed: false },
    warning: 'Closed.',
  };
  // Both orders, because "the last one listed wins" happens to give the right
  // answer for one of them. Only running both proves ordering is not load-bearing.
  const a = inside();
  applyLandManagers([a], [permissive, closed]);
  assert.equal(a.access.status, 'closed');
  assert.equal(a.access.bathingAllowed, false);
  assert.deepEqual(a.warnings, ['Permit required.', 'Closed.']);

  const b = inside();
  applyLandManagers([b], [closed, permissive]);
  assert.equal(b.access.status, 'closed', 'a permissive entry listed last must not relax it');
  assert.equal(b.access.bathingAllowed, false);
  assert.deepEqual(b.warnings, ['Closed.', 'Permit required.']);
});

test('a transposed bbox is rejected at load rather than silently matching nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-'));
  const file = path.join(dir, 'lm.json');
  // [minLat, minLng, maxLat, maxLng]: the classic mix-up. A latitude of -111
  // is impossible, which is what makes this detectable at all.
  fs.writeFileSync(
    file,
    JSON.stringify([{ ...YELLOWSTONE, bbox: [44.132, -111.156, 45.102, -109.816] }]),
  );
  assert.throws(() => loadLandManagers(file), /latitude/i);
});

test('a malformed entry is fatal, never treated as absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-'));
  const cases = {
    'no-warning.json': [{ ...YELLOWSTONE, warning: '' }],
    'short-bbox.json': [{ ...YELLOWSTONE, bbox: [-111.156, 44.132] }],
    'bad-status.json': [{ ...YELLOWSTONE, access: { status: 'maybe', bathingAllowed: false } }],
    'bad-flag.json': [{ ...YELLOWSTONE, access: { status: 'view-only', bathingAllowed: 'no' } }],
    'inverted.json': [{ ...YELLOWSTONE, bbox: [-109.816, 44.132, -111.156, 45.102] }],
    'not-array.json': { entries: [] },
    'no-source.json': [{ ...YELLOWSTONE, source: null }],
    'duplicate-id.json': [YELLOWSTONE, YELLOWSTONE],
  };
  for (const [name, body] of Object.entries(cases)) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(body));
    assert.throws(() => loadLandManagers(file), undefined, `${name} must be rejected`);
  }
});

test('a missing file is fatal: a safety layer must not be optional', () => {
  assert.throws(
    () => loadLandManagers(path.join(os.tmpdir(), 'definitely-not-here-land-managers.json')),
    /not found/i,
  );
});

test('the committed land-manager file is valid and spans the whole park', () => {
  const managers = loadLandManagers(LAND_MANAGERS_FILE);
  const yell = managers.find((m) => m.id === 'us-nps-yellowstone');
  assert.ok(yell, 'the Yellowstone entry must be present');
  assert.equal(yell.access.status, 'view-only');
  assert.equal(yell.access.bathingAllowed, false);
  // The warning names the park rather than hedging with "in or near", so the
  // bbox may not be widened past the park without revisiting the wording.
  assert.match(yell.warning, /Yellowstone National Park/);
  for (const p of [
    { lat: 44.4605, lng: -110.8281, name: 'Old Faithful' },
    { lat: 44.9766, lng: -110.7036, name: 'Mammoth Hot Springs' },
    { lat: 44.4165, lng: -110.5735, name: 'Abyss Pool' },
    { lat: 44.6096, lng: -110.4353, name: 'Mud Volcano' },
  ]) {
    assert.equal(matchingManagers({ location: p }, managers).length, 1, `${p.name} must be covered`);
  }
});

test('the shipped dataset carries the layer, on a pinned real count', () => {
  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const managers = loadLandManagers(LAND_MANAGERS_FILE);
  const covered = springs.filter((s) => matchingManagers(s, managers).length > 0);
  assert.equal(covered.length, EXPECTED_COVERED, 'the Yellowstone bbox coverage changed');

  for (const s of covered) {
    assert.equal(s.access.status, 'view-only', `${s.id} shipped without the status`);
    assert.equal(s.access.bathingAllowed, false, `${s.id} shipped bathing-allowed`);
    assert.ok(
      s.warnings.some((w) => /prohibited in Yellowstone National Park/.test(w)),
      `${s.id} shipped without the land-manager warning`,
    );
  }
});

test('the named features that motivated this layer ship flagged', () => {
  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  for (const name of ['Abyss Pool', 'Black Diamond Pool', 'Morning Glory Pool', 'Excelsior Geyser']) {
    const s = springs.find((x) => x.name === name);
    assert.ok(s, `${name} is missing from the dataset`);
    assert.equal(s.access.bathingAllowed, false, `${name} shipped bathing-allowed`);
    assert.equal(s.access.status, 'view-only', `${name} shipped without the status`);
  }
});

test('every shipped record carries the two new access fields', () => {
  // Mandatory, not optional: the UI reads them without optional chaining.
  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const STATUSES = ['public', 'permit', 'view-only', 'closed', 'unknown'];
  for (const s of springs) {
    assert.ok(STATUSES.includes(s.access.status), `${s.id} has status ${s.access.status}`);
    assert.ok(
      s.access.bathingAllowed === null || typeof s.access.bathingAllowed === 'boolean',
      `${s.id} has a non-boolean bathingAllowed`,
    );
  }
});

test('the UI renders the prohibition, above the general warnings', () => {
  // This repo already ships `photos` in the schema with no UI. A safety field
  // nobody renders is worse than no field at all, so the render is asserted
  // rather than assumed.
  const ui = fs.readFileSync('src/components/DetailPanel.tsx', 'utf8');
  const banner = ui.indexOf('access.bathingAllowed === false');
  const warnings = ui.indexOf('spring.warnings.length > 0');
  assert.ok(banner > 0, 'DetailPanel must branch on bathingAllowed === false');
  assert.ok(
    banner < warnings,
    'the prohibition must render above the warnings list, not inside or below it',
  );
  assert.match(ui, /Do not enter the water/);
  // The directions link stays: visiting is legal, implying you may bathe is
  // the harm. Removing it would be a different, unhelpful change.
  assert.match(ui, /google\.com\/maps\/dir/);
});

test('the banner is keyed on the flag, not on the warning text', () => {
  // If the UI matched on the warning string instead, an overlay that rewrote
  // `warnings` would silently remove the prohibition from the screen.
  const ui = fs.readFileSync('src/components/DetailPanel.tsx', 'utf8');
  assert.ok(
    !/Yellowstone/.test(ui),
    'the UI must not hard-code a park name; it renders the structured flag',
  );
});

test('the two access fields are declared mandatory, not optional', () => {
  // `status?: AccessStatus` would still typecheck everywhere and would still
  // let the UI read the flag — right up until a record lacked it, when
  // `undefined === false` is false and the prohibition silently disappears.
  // Nothing else in the suite catches an added `?`, so it is asserted here.
  const types = fs.readFileSync('src/lib/types.ts', 'utf8');
  assert.match(types, /^\s*status: AccessStatus;$/m, 'access.status must not be optional');
  assert.match(types, /^\s*bathingAllowed: boolean \| null;$/m, 'bathingAllowed must not be optional');
  assert.match(
    types,
    /export type AccessStatus = 'public' \| 'permit' \| 'view-only' \| 'closed' \| 'unknown';/,
  );
});

test('an unrestricted spring asserts nothing about bathing', () => {
  // `false` is a prohibition; `null` is silence. Defaulting the 5,000-odd
  // springs no land manager covers to `true` would be inventing a permission
  // nobody granted, which is the one thing this schema forbids everywhere else.
  assert.equal(parseAccess({ fee: 'no' }).bathingAllowed, null);
  assert.equal(parseAccess({ fee: 'no' }).status, 'unknown');
  assert.equal(parseAccess({ access: 'permissive' }).bathingAllowed, null);

  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const managers = loadLandManagers(LAND_MANAGERS_FILE);
  const free = springs.filter((s) => matchingManagers(s, managers).length === 0);
  assert.equal(free.length, springs.length - EXPECTED_COVERED);
  for (const s of free) {
    assert.equal(s.access.bathingAllowed, null, `${s.id} claims a bathing permission`);
    assert.equal(s.access.status, 'unknown', `${s.id} claims an access status`);
  }
});
