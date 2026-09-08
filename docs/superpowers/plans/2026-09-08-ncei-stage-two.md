# NCEI Stage Two Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit the ~1,031 NOAA rows that qualify under the stage-two decisions as new, unverified, NCEI-only springs, and quarantine the rest in public with their reasons.

**Architecture:** Admission is a **separate stage from enrichment and runs earlier**. Enrichment binds a row to a record that already exists and can run late; admission *creates* records, so it must run before dedupe and identity or the new records never receive a durable `whs_` id. One pure classifier and one pure record builder feed a stage inserted above `dedupe()`.

**Tech Stack:** Node 24, ESM (`.mjs`), `node:test` + `node:assert/strict`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-ncei-stage-two-admission.md`

---

## The ordering problem, and why the stage goes where it goes

`build-dataset.mjs` today:

```
:231  dedupe(records)
:239  resolveRegistry(...)        <- durable whs_ ids are minted here
:274  NCEI enrichment (stage one) <- fills temperatures on existing records
:374  applyOverlays
:407  privacy filter
```

Stage one sits at `:274` because it only *reads* records. Stage two **creates** them, and a record created at `:274` has already missed identity resolution — it would be published with no `whs_` id at all. `refsOf()` in `identity.mjs` throws a targeted error for precisely this case, naming this spec.

**Admission therefore goes immediately before `dedupe()` at `:231`**, which buys three things beyond correctness:

- Admitted records get durable ids from `resolveRegistry` via their own `sourceRefs`.
- They pass through `dedupe()`, whose `isSameSpring` (60 m anonymous, 300 m exact-name) is a second safety net catching near-duplicates the 200 m matcher rejected on a name disagreement.
- They pass through the privacy filter, which is last and asserted to be last.

Stage one's enrichment stays exactly where it is. An admitted record arrives at `:274` already carrying its temperature, so the enrichment stage matches it at ~0 m and skips it — `filled` only counts records whose temperature was null.

---

## File Structure

| Path | Responsibility |
|---|---|
| `scripts/lib/ncei-admit.mjs` | **Create.** Pure. One row + the manager list → admit or a reason. Also builds the record. |
| `scripts/ncei-admit.test.mjs` | **Create.** Tests for every admission rule. |
| `scripts/build-dataset.mjs` | **Modify.** Insert the admission stage before `dedupe()`. |
| `scripts/build.test.mjs` | **Modify.** Ordering guard; amend the provenance guard. |
| `scripts/lib/pathguard.mjs` | **Modify.** Allow `data/ncei-candidates.json`. |
| `data/ncei-candidates.json` | Run output. Every rejected row and why. |

---

### Task 0: The match report has no date on it

**Files:**
- Modify: `scripts/build-dataset.mjs:340`

Found while reviewing this plan. Stage one wrote `generatedAt: buildDate`,
passing the *function* rather than calling it. `JSON.stringify` drops a
function value silently, so every `ncei-match-report.json` shipped so far has
no `generatedAt` key at all — the field reads `undefined`, and nothing said so.

- [ ] **Step 1: Confirm the field is missing**

Run:

```bash
node -e "const r=require('./data/ncei-match-report.json');console.log(Object.keys(r).join(', '))"
```

Expected: `counts, conflicts, rejected, parseRejects, unmatched` — no
`generatedAt`.

- [ ] **Step 2: Call it**

In `scripts/build-dataset.mjs:340`, replace `generatedAt: buildDate,` with:

```js
          generatedAt: ingestedAt,
```

`ingestedAt` is `buildDate(RAW_DIR)`, already computed at `:154`, and is the
same value every other dated artefact in the build uses.

- [ ] **Step 3: Rebuild and confirm the date appears**

```bash
npm run data:build
node -e "const r=require('./data/ncei-match-report.json');console.log('generatedAt:',r.generatedAt)"
```

Expected: a `YYYY-MM-DD` date, not `undefined`.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-dataset.mjs data/ncei-match-report.json
git commit -m "fix: the match report's generatedAt was a function, so JSON dropped it"
```

---

### Task 1: The admission classifier

**Files:**
- Create: `scripts/lib/ncei-admit.mjs`
- Test: `scripts/ncei-admit.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/ncei-admit.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './lib/ncei-admit.mjs';

/** One no-bathing manager, shaped like data/land-managers.json. */
const MANAGERS = [
  {
    id: 'us-nps-yellowstone',
    bbox: [-111.156, 44.132, -109.816, 45.102],
    access: { status: 'view-only', bathingAllowed: false },
  },
  // A manager that permits bathing must NOT defer anything.
  { id: 'permissive', bbox: [0, 0, 1, 1], access: { bathingAllowed: true } },
];
const row = (over = {}) => ({
  state: 'NV', lat: 39.123, lng: -117.456, name: 'BARANOF WARM SPRINGS',
  celsius: 51, qualitative: null, ...over,
});

test('a named, precise, soak-class row outside every no-bathing park is admitted', () => {
  assert.deepEqual(classify(row(), MANAGERS), { admit: true });
});

test('a view-only feature is rejected', () => {
  for (const name of ['FUMAROLE', 'FUMAROLES ON GARELOI ISLAND', 'STEAM VENTS', 'MUD POTS', 'LITTLE GEYSERS']) {
    assert.deepEqual(classify(row({ name }), MANAGERS), { admit: false, reason: 'view-only feature' }, name);
  }
});

test('a name that claims water is soak-class even when it mentions a geyser', () => {
  // Measured: 13 real springs would be lost to a lexicon without this clause.
  for (const name of ['HOT SPRINGS NEAR GEYSER BIGHT', 'GEYSER WARM SPRING', 'BEOWAWE HOT SPRINGS (THE GEYSERS)']) {
    assert.deepEqual(classify(row({ name }), MANAGERS), { admit: true }, name);
  }
});

test('the feature words match whole words, never substrings', () => {
  // STEAMBOAT contains STEAM, BIDWELL contains WELL, SULPHUR is not a feature.
  for (const name of ['STEAMBOAT SPRINGS', 'FORT BIDWELL HOT SPRING', 'WHITE SULPHUR SPRINGS']) {
    assert.deepEqual(classify(row({ name }), MANAGERS), { admit: true }, name);
  }
});

test('a generic name is a coordinate wearing a type, and is rejected', () => {
  for (const name of ['HOT SPRINGS', 'WARM SPRING', 'SPRING', 'SEEP', 'HOT SPRING', 'SPRING (HOT)']) {
    assert.deepEqual(classify(row({ name }), MANAGERS), { admit: false, reason: 'generic or absent name' }, name);
  }
});

test('an absent name is rejected', () => {
  assert.deepEqual(classify(row({ name: null }), MANAGERS), { admit: false, reason: 'generic or absent name' });
});

test('coordinates coarser than 3 decimal places are rejected', () => {
  assert.deepEqual(classify(row({ lat: 39.12 }), MANAGERS), { admit: false, reason: 'coordinates coarser than 3 dp' });
  assert.deepEqual(classify(row({ lng: -117.4 }), MANAGERS), { admit: false, reason: 'coordinates coarser than 3 dp' });
  assert.deepEqual(classify(row({ lat: 39.1234 }), MANAGERS), { admit: true }, '4 dp is finer than 3 and must pass');
});

test('a row inside a no-bathing boundary is deferred, not admitted', () => {
  const inPark = row({ lat: 44.6, lng: -110.5, name: 'SHELF SPRING' });
  assert.deepEqual(classify(inPark, MANAGERS), { admit: false, reason: 'inside a no-bathing boundary' });
});

test('a manager that allows bathing defers nothing', () => {
  const inPermissive = row({ lat: 0.5, lng: 0.5 });
  assert.deepEqual(classify(inPermissive, MANAGERS), { admit: true });
});

test('the rules are applied in a fixed order, so a row gets one reason', () => {
  // A generic name inside a park is reported as generic: the cheaper, more
  // specific reason wins, and a row must never carry two.
  const both = row({ name: 'HOT SPRINGS', lat: 44.6, lng: -110.5 });
  assert.equal(classify(both, MANAGERS).reason, 'generic or absent name');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/ncei-admit.test.mjs`
Expected: FAIL — `Cannot find module './lib/ncei-admit.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/ncei-admit.mjs`:

```js
/**
 * Which NOAA rows may become springs in this atlas.
 *
 * Pure: a row and the manager list in, a verdict out. The rules and their
 * reasoning are in
 * docs/superpowers/specs/2026-09-08-ncei-stage-two-admission.md.
 *
 * The posture throughout is under-import. This is name-only classification
 * against a table with no type column, so it will miss some; shipping a
 * fumarole as a hot spring is the error that matters.
 */

/**
 * A view-only feature word, as a WHOLE word. Substring matching is wrong in
 * this direction and measured to be: STEAMBOAT SPRINGS contains "STEAM",
 * FORT BIDWELL contains "WELL", WHITE SULPHUR SPRINGS contains "SULPHUR".
 */
const VIEW =
  /\b(FUMAROLE|FUMAROLES|GEYSER|GEYSERS|MUDPOT|MUDPOTS|MUDKETTLE|PAINTPOT|PAINTPOTS|SOLFATARA)\b|\b(MUD|STEAM|GAS|PAINT)\s+(POT|POTS|VENT|VENTS|VOLCANO|VOLCANOES|CAVE|CAVES)\b/i;

/**
 * A water word. A name claiming a spring or pool is soak-class even when it
 * also names the geyser next door -- HOT SPRINGS NEAR GEYSER BIGHT. Measured:
 * without this clause 13 real springs are lost.
 */
const WATER = /\b(SPRING|SPRINGS|POOL|POOLS|LAGOON|BATHS?|HOT\s+WELLS?)\b/i;

/** A name made only of these identifies no particular spring. */
const GENERIC = /^(HOT|WARM|THERMAL)?\s*(SPRING|SPRINGS|POOL|POOLS|SEEP|SEEPS)?\s*(\(HOT\)|\(WARM\))?$/i;

/** Degrees of precision below which a pin is not safe to publish. */
export const MIN_DECIMAL_PLACES = 3;

function decimals(v) {
  const s = String(v);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

function inNoBathing(row, managers) {
  return managers.some((m) => {
    if (m?.access?.bathingAllowed !== false) return false;
    const [minLng, minLat, maxLng, maxLat] = m.bbox;
    return row.lng >= minLng && row.lng <= maxLng && row.lat >= minLat && row.lat <= maxLat;
  });
}

/**
 * Rules run in a fixed order so a row carries exactly one reason, and the
 * cheaper, more specific one wins. A generic name inside a park is reported as
 * generic, because that is the fact about the row rather than about where it
 * happens to sit.
 */
export function classify(row, managers) {
  const name = (row.name ?? '').trim();
  if (name && VIEW.test(name) && !WATER.test(name)) {
    return { admit: false, reason: 'view-only feature' };
  }
  if (!name || GENERIC.test(name)) {
    return { admit: false, reason: 'generic or absent name' };
  }
  if (Math.min(decimals(row.lat), decimals(row.lng)) < MIN_DECIMAL_PLACES) {
    return { admit: false, reason: 'coordinates coarser than 3 dp' };
  }
  if (inNoBathing(row, managers)) {
    return { admit: false, reason: 'inside a no-bathing boundary' };
  }
  return { admit: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/ncei-admit.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/ncei-admit.mjs scripts/ncei-admit.test.mjs
git commit -m "feat: decide which NOAA rows may become springs"
```

---

### Task 2: Build the record

**Files:**
- Modify: `scripts/lib/ncei-admit.mjs`
- Test: `scripts/ncei-admit.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/ncei-admit.test.mjs`:

```js
import { toRecord, NCEI_PROVIDER, NCEI_SOURCE, NCEI_HISTORICAL_WARNING } from './lib/ncei-admit.mjs';

const built = () =>
  toRecord(
    { state: 'AK', lat: 57.085, lng: -134.839, name: 'BARANOF WARM SPRINGS', celsius: 51, qualitative: null },
    '2026-09-08',
  );

test('an admitted record declares its own source ref, or it can never get an id', () => {
  // identity.mjs throws by name for a record that yields no ref. This is the
  // field that stops that happening.
  assert.deepEqual(built().sourceRefs, [{ provider: 'ncei', externalId: 'AK/57.085/-134.839' }]);
  assert.equal(NCEI_PROVIDER, 'ncei');
});

test('an admitted record is NCEI-only in its provenance', () => {
  assert.deepEqual(built().quality.provenance, ['ncei']);
});

test('an admitted record is never verified and says when it was measured', () => {
  const r = built();
  assert.equal(r.verified, false);
  assert.equal(r.temperature.celsius, 51);
  assert.equal(r.temperature.fahrenheit, 123.8);
  assert.equal(r.temperature.measuredAt, '1981');
  assert.equal(r.temperature.source, NCEI_SOURCE);
  assert.match(NCEI_SOURCE, /10\.25921\/c8p0-zs06/);
});

test('an admitted record warns that its very existence is unchecked', () => {
  // Not just the reading. Nobody has confirmed the spring is still there.
  const r = built();
  assert.ok(r.warnings.includes(NCEI_HISTORICAL_WARNING));
  assert.match(NCEI_HISTORICAL_WARNING, /1981/);
  assert.match(NCEI_HISTORICAL_WARNING, /not been checked on the ground/i);
});

test('a scalding admitted record keeps the normal safety warning too', () => {
  const hot = toRecord({ state: 'WY', lat: 44.5, lng: -110.8, name: 'X SPRING', celsius: 92, qualitative: null }, '2026-09-08');
  assert.ok(hot.warnings.some((w) => /Scalding/.test(w)), 'the 50C rule must still apply');
  assert.ok(hot.warnings.includes(NCEI_HISTORICAL_WARNING));
});

test('a qualitative-only row carries the word and no number', () => {
  const q = toRecord({ state: 'AK', lat: 52.84, lng: -169.9, name: 'CHUGINADAK HOT SPRINGS', celsius: null, qualitative: 'hot' }, '2026-09-08');
  assert.equal(q.temperature.celsius, null);
  assert.equal(q.temperature.fahrenheit, null);
  assert.equal(q.temperature.qualitative, 'hot');
});

test('an admitted record cites the DOI and carries every schema field', () => {
  const r = built();
  assert.ok(r.sources.includes(NCEI_SOURCE));
  // Unknown is stored, never omitted -- the schema rule the whole record model
  // rests on. A missing key makes spring.minerals.ph throw in the UI.
  for (const k of ['access', 'clothing', 'hours', 'minerals', 'location', 'temperature', 'quality']) {
    assert.ok(r[k] && typeof r[k] === 'object', `${k} must be present`);
  }
  assert.equal(r.minerals.ph, null);
  assert.equal(r.access.status, 'unknown');
  assert.equal(r.location.country, 'US');
  assert.equal(r.type, 'natural');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/ncei-admit.test.mjs`
Expected: FAIL — `toRecord` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/lib/ncei-admit.mjs`:

```js
import { deriveWarnings } from './normalize.mjs';

export const NCEI_PROVIDER = 'ncei';

export const NCEI_SOURCE =
  'NOAA NCEI, Thermal Springs List for the United States (1981), doi:10.25921/c8p0-zs06';

/**
 * The reading is 45 years old and so is the claim that the spring exists. A
 * record nobody has visited should say so on its own card, not only in a
 * provenance field a reader has to go looking for.
 */
export const NCEI_HISTORICAL_WARNING =
  'Recorded in a 1981 federal compilation and not been checked on the ground since. ' +
  'The temperature, and the existence of this spring, are historical.';

/**
 * The row's identity within its provider, and it must survive a re-fetch.
 * The mirror has no id column, so the key is what the TSV prints: the file is
 * pinned by sha256 and regenerated deterministically, so these strings are
 * stable as long as the pin is.
 */
export function refKey(row) {
  return `${row.state}/${row.lat}/${row.lng}`;
}

/** A NOAA row as a full HotSpring, ready to enter the pipeline before dedupe. */
export function toRecord(row, ingestedAt) {
  const celsius = row.celsius;
  const warnings = [
    ...deriveWarnings({}, celsius, 'natural'),
    NCEI_HISTORICAL_WARNING,
  ];
  return {
    // Provisional. resolveRegistry replaces it with the minted whs_ id, which
    // it derives from sourceRefs below.
    id: `${NCEI_PROVIDER}:${refKey(row)}`,
    sourceRefs: [{ provider: NCEI_PROVIDER, externalId: refKey(row) }],
    name: row.name,
    location: {
      lat: row.lat, lng: row.lng, elevation: null,
      country: 'US', countryName: 'United States of America',
      region: row.state, nearestTown: null,
    },
    temperature: {
      celsius,
      fahrenheit: celsius === null ? null : Math.round(((celsius * 9) / 5 + 32) * 10) / 10,
      source: NCEI_SOURCE,
      measuredAt: '1981',
      qualitative: row.qualitative,
      kind: 'source',
    },
    access: { price: null, currency: null, notes: null, status: 'unknown', bathingAllowed: null },
    clothing: { policy: 'unknown', schedule: null, notes: null },
    hours: { open: null, seasonalNotes: null, status: 'unknown' },
    minerals: {
      ph: null, tds: null, sulfate: null, bicarbonate: null, chloride: null,
      calcium: null, magnesium: null, sodium: null, silica: null, iron: null,
      types: [], notes: null, measuredAt: null,
    },
    type: 'natural',
    unicorn: false,
    verified: false,
    lastVerified: ingestedAt,
    sources: [NCEI_SOURCE],
    description: null,
    tags: [],
    warnings,
    quality: { provenance: [NCEI_PROVIDER], completeness: 0, known: [], ingestedAt },
    osmRefs: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/ncei-admit.test.mjs`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/ncei-admit.mjs scripts/ncei-admit.test.mjs
git commit -m "feat: build an admitted NOAA row into a full, unverified record"
```

---

### Task 3: The admission stage

**Files:**
- Modify: `scripts/build-dataset.mjs`
- Modify: `scripts/lib/pathguard.mjs:17`
- Test: `scripts/build.test.mjs`

- [ ] **Step 1: Write the failing ordering test**

Append to `scripts/build.test.mjs`:

```js
test('NCEI admission runs before dedupe and identity, or new records get no id', () => {
  const admitAt = SOURCE.indexOf('classify(');
  const dedupeAt = SOURCE.indexOf('dedupe(records)');
  const identityAt = SOURCE.indexOf('resolveRegistry(');
  assert.ok(admitAt > 0, 'the admission stage must exist');
  assert.ok(
    admitAt < dedupeAt,
    'admission must run BEFORE dedupe: a record created after it never reaches ' +
      'isSameSpring, which is the second net catching duplicates the 200 m ' +
      'matcher rejected on a name disagreement.',
  );
  assert.ok(
    admitAt < identityAt,
    'admission must run BEFORE resolveRegistry, which is where durable whs_ ids ' +
      'are minted. A record created after it is published with no id at all.',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/build.test.mjs`
Expected: FAIL — `the admission stage must exist`

- [ ] **Step 3: Add the stage**

In `scripts/build-dataset.mjs`, extend the NCEI imports:

```js
import { classify, toRecord } from './lib/ncei-admit.mjs';
```

Insert immediately **before** the `// --- Deduplicate ---` comment at `:225`,
which precedes `dedupe(records)` at `:231`:

```js
  // --- NCEI admission ---
  // Creates records, so it must run above dedupe and identity: a record made
  // after resolveRegistry never gets a durable whs_ id, and refsOf() throws by
  // name for exactly that case. Placed here it also passes through
  // isSameSpring, a second net under the 200 m matcher, and through the
  // privacy filter, which is last.
  const NCEI_TSV_ADMIT = path.join('data', 'reference', 'ncei-thermal-springs.tsv');
  if (fs.existsSync(NCEI_TSV_ADMIT)) {
    console.log('Admitting NCEI springs ...');
    const { springs: allRows } = parseNcei(fs.readFileSync(NCEI_TSV_ADMIT, 'utf8'));
    const managers = loadLandManagers();
    // Only rows that match nothing already in the atlas are candidates for
    // admission. A row that matches is stage one's business.
    const { unmatched } = matchNcei(allRows, records);

    const admitted = [];
    const candidates = [];
    for (const { row } of unmatched) {
      const verdict = classify(row, managers);
      if (verdict.admit) {
        admitted.push(toRecord(row, ingestedAt));
      } else {
        candidates.push({ ...row, reason: verdict.reason });
      }
    }
    records = [...records, ...admitted];

    fs.writeFileSync(
      path.join('data', 'ncei-candidates.json'),
      `${JSON.stringify(
        {
          generatedAt: buildDate(RAW_DIR),
          note:
            'NOAA rows that did not become springs, and why. Public because ' +
            'calling a row unfit is a claim and must be arguable. Never deleted.',
          counts: candidates.reduce(
            (acc, c) => ({ ...acc, [c.reason]: (acc[c.reason] ?? 0) + 1 }),
            { admitted: admitted.length },
          ),
          candidates,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`  ${admitted.length} admitted, ${candidates.length} quarantined -> data/ncei-candidates.json`);
  }
```

- [ ] **Step 4: Allow the quarantine file in the path guard**

`data/ncei-candidates.json` is a run output like `coverage.json`. In
`scripts/lib/pathguard.mjs`, extend `ALLOWED_FILES`:

```js
export const ALLOWED_FILES = [
  'data/coverage.json',
  'data/refutations.jsonl',
  'data/ncei-match-report.json',
  'data/ncei-candidates.json',
];
```

- [ ] **Step 5: Run the build**

Run: `npm run data:build`

Expected: an `Admitting NCEI springs ...` line reading roughly
`1031 admitted, 475 quarantined`, the spring count rising from 6,467 to about
7,400 (dedupe may absorb a few), and `temperature known` rising by about 970.

**If the build throws `yields no source ref`**, `sourceRefs` is not reaching
`resolveRegistry` — check that `toRecord` sets it and that nothing between the
two stages strips it.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-dataset.mjs scripts/lib/pathguard.mjs scripts/build.test.mjs data/
git commit -m "feat: admit qualifying NOAA rows as new springs, above dedupe"
```

---

### Task 4: Let an NCEI-only record exist

**Files:**
- Modify: `scripts/build.test.mjs:221`

- [ ] **Step 1: Run the suite to see the guard fire**

Run: `npm test`
Expected: FAIL — `... is not derived from OSM, but every record's identity is`.
This is the guard added in stage one, when every record was an OSM record. It
is now wrong, and it is *supposed* to fail here rather than let the first
NCEI-only record through unnoticed.

- [ ] **Step 2: Amend it precisely**

Replace the OSM requirement with a non-empty check. Keep the known-provider set
and the no-duplicates rule — those still hold and are the parts that catch a
typo'd provider.

```js
    assert.ok(
      s.quality.provenance.every((p) => PROVIDERS.has(p)),
      `${s.id} names a provider no stage in this build can produce`,
    );
    assert.equal(
      new Set(s.quality.provenance).size,
      s.quality.provenance.length,
      `${s.id} names the same provider twice`,
    );
```

Delete only the `includes('osm')` assertion and its message.

- [ ] **Step 3: Add the test that replaces it**

Append to `scripts/build.test.mjs`:

```js
test('an NCEI-only record is a real record: id, refs, warning, unverified', () => {
  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const only = springs.filter((s) => s.quality.provenance.length === 1 && s.quality.provenance[0] === 'ncei');
  assert.ok(only.length > 0, 'stage two should have admitted some');
  for (const s of only) {
    assert.match(s.id, /^whs_[0-9a-f]{12}$/, `${s.id} is not a durable id`);
    assert.equal(s.verified, false, `${s.id} is unverified by construction`);
    assert.ok(
      s.warnings.some((w) => /1981/.test(w)),
      `${s.id} must say on its own card that it is historical`,
    );
    assert.deepEqual(s.osmRefs, [], `${s.id} has no OSM ref, by definition`);
  }
});
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Mutation-check the amended guard**

The guard must still catch an invented provider. Break the data on purpose:

```bash
node -e "const fs=require('fs');const p='data/hot-springs.json';const d=JSON.parse(fs.readFileSync(p,'utf8'));d[0].quality.provenance=['osm','noaa-typo'];fs.writeFileSync(p,JSON.stringify(d));"
npm test 2>&1 | grep "noaa-typo"
npm run data:build
```

Expected: the grep prints the assertion naming `noaa-typo`, and the rebuild
restores the file. If the grep prints nothing, the guard stopped guarding.

- [ ] **Step 6: Commit**

```bash
git add scripts/build.test.mjs data/
git commit -m "test: an NCEI-only record is allowed to exist, and must look like one"
```

---

### Task 5: Look at what shipped

**Files:** none modified. This is the step that catches what tests cannot.

- [ ] **Step 1: Read the quarantine counts**

Run:

```bash
node -e "const r=require('./data/ncei-candidates.json');console.log(JSON.stringify(r.counts,null,1))"
```

Expected, from the measured funnel: `admitted` about 1031, `view-only feature`
53, `generic or absent name` 137, `coordinates coarser than 3 dp` 241,
`inside a no-bathing boundary` 44.

If `admitted` is far from 1031, a rule is firing differently than measured;
find out which before continuing.

- [ ] **Step 2: Check dedupe did not silently eat the new records**

Run:

```bash
node -e "
const d=require('./data/hot-springs.json');
const ncei=d.filter(s=>s.quality.provenance.includes('ncei'));
const only=ncei.filter(s=>s.quality.provenance.length===1);
const both=ncei.filter(s=>s.quality.provenance.length>1);
console.log('total springs', d.length);
console.log('ncei-only (new)', only.length, '| osm+ncei (merged or enriched)', both.length);
"
```

A large gap between 1,031 admitted and the ncei-only count means `dedupe`
merged them into OSM records. That is not necessarily wrong — it is the second
net doing its job — but it must be understood and reported, not discovered later.

- [ ] **Step 3: Look at one on the map**

Run `npm run dev`, search a name from the admitted list (`BARANOF WARM
SPRINGS`), select it, and confirm: the temperature shows, the 1981 measurement
line shows, the historical warning shows, and the source cites the DOI.

A record that publishes without its historical warning is the failure mode
this whole decision was designed to avoid, and no source-scan test can see it.

- [ ] **Step 4: Reset the viewport and stop the dev server when done**

---

### Task 6: Green path and the PR

- [ ] **Step 1: Run everything, in this order**

`data:build` before `npm test`, because `docs.test.mjs` reads `summary.json`.

```bash
npm run data:build && npm test && npx tsc -b --force && npm run build
```

- [ ] **Step 2: Update the README counts**

Both the headline and the coverage table will move. Run:

```bash
node -e "const s=require('./data/summary.json');console.log(s.total+' springs, '+s.countries+' countries, temperature '+Math.round(s.coverage.temperature/s.total*100)+'%')"
```

Update `README.md:11` and the `| Temperature |` row to match, then re-run
`npm test`.

- [ ] **Step 3: Commit and open the PR against `main`**

```bash
git add -u
git commit -m "data: NCEI stage two admits the American springs the atlas was missing"
git push -u origin feat/ncei-stage-two
gh pr create --base main --title "feat: NCEI stage two — admit qualifying NOAA-only springs"
```

**Base on `main`, and open only this one PR.** Stacking put nine merged PRs
inside each other on 2026-09-05 and cost a recovery merge, then did it again to
#49.

The PR body must state the honest headline: this grows the atlas by roughly
16% and every new pin is a 1981 record nobody has visited. That is the change
the reviewer is approving, and it should be the first thing they read.

---

## Deliberately not in this plan

A site hierarchy (basin / group / vent) for Yellowstone; removing the OSM
Yellowstone vents already published; promoting a quarantined candidate back
into the atlas. All three are their own specs.
