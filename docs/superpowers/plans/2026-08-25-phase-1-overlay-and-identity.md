# Phase 1: Durable Identity and the Curated Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every spring a durable id that survives OSM rebuilds, and let authored field-level claims override derived values without being wiped by the next ingest.

**Architecture:** The build gains two stages between dedupe and the privacy filter. Identity resolution assigns each deduped record a stable `whs_` id via a committed registry, matching on OSM ref first and falling back to the existing `isSameSpring()` predicate. Overlay merge then applies authored claims over derived values, detects disagreement with upstream, and emits events. The privacy filter moves to genuinely last, and the build becomes byte-for-byte reproducible so its 6 MB output diff is reviewable.

**Tech Stack:** Node 24 ESM, `node:test`, `node:assert/strict`. No new dependencies.

**Scope:** Local only. No GitHub Actions, no contribution gates, no LLM manager, no trust levels. Those are phases 2 and 3.

**Spec:** `docs/superpowers/specs/2026-08-25-agent-contribution-system-design.md`

---

## File Structure

**New modules** (each one responsibility, each independently testable):

| File | Responsibility |
|---|---|
| `scripts/lib/geo.mjs` | Distance and name normalisation. Shared by identity, dedupe, and exclusions, which currently each carry their own copy. |
| `scripts/lib/identity.mjs` | `whs_` id minting, registry resolution, the `isSameSpring` predicate moved out of the build script. |
| `scripts/lib/overlay.mjs` | Claim loading, merge over derived records, drift detection, claim accounting. |
| `scripts/lib/events.mjs` | Append-only event log writer with replay-safe deduplication. |
| `scripts/lib/buildtime.mjs` | Deterministic build timestamps. |

**New tests:** `scripts/geo.test.mjs`, `scripts/identity.test.mjs`, `scripts/buildtime.test.mjs`, `scripts/overlay.test.mjs`, `scripts/events.test.mjs`, `scripts/build.test.mjs`

**New data:** `data/registry.json`, `data/overlay/` (with `.gitkeep`), `data/events.jsonl`

**Modified:** `scripts/build-dataset.mjs`, `scripts/lib/exclusions.mjs`, `src/lib/types.ts`, `package.json`, `docs/DATA.md`, `CONTRIBUTING.md`

---

## Two defects this phase fixes

Both were found while planning, and both are in the current code:

1. **The privacy filter does not run last.** `scripts/build-dataset.mjs:272` carries the comment *"The privacy guard. This runs last so nothing can slip past it"* — but `dedupe()` runs afterwards at line 288. It is currently harmless (radius exclusion removes a spring's duplicates too), but `mergeInto()` moves a merged record's coordinates to the winner's position, so a merge could in principle shift a record into an exclusion radius after the check has passed. Task 6 fixes the ordering. This is the project's central guarantee and the comment asserting it is false.

2. **The build is not reproducible.** `build-dataset.mjs:202` sets `ingestedAt` from `new Date()`, which writes today's date into `lastVerified` on all 6,470 records, and line 304 stamps `metadata.generated` the same way. Every rebuild therefore produces a 6 MB diff in which the real change is invisible. Tasks 4 and 5 fix it.

---

## Task 1: Extract shared geo helpers

Three copies of haversine exist: `build-dataset.mjs:47`, `exclusions.mjs:44`, and `countries.mjs` uses a planar approximation for a different purpose (leave that one alone). The two haversines have different signatures, which is how they drifted apart.

**Files:**
- Create: `scripts/lib/geo.mjs`
- Create: `scripts/geo.test.mjs`
- Modify: `scripts/lib/exclusions.mjs` (remove local `haversine`, import `distanceMeters`)

- [ ] **Step 1: Write the failing test**

Create `scripts/geo.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, normName } from './lib/geo.mjs';

test('distanceMeters: identical points are zero apart', () => {
  const p = { lat: 64.048, lng: -21.2222 };
  assert.equal(distanceMeters(p, p), 0);
});

test('distanceMeters: one degree of latitude is about 111km', () => {
  const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(d > 110_500 && d < 111_500, `expected ~111km, got ${Math.round(d)}m`);
});

test('distanceMeters: matches the Lahuen duplicate spacing that drove the 300m rule', () => {
  const a = { lat: -39.826478, lng: -71.636675 };
  const b = { lat: -39.822813, lng: -71.633676 };
  const d = distanceMeters(a, b);
  assert.ok(d > 350 && d < 550, `expected 350-550m, got ${Math.round(d)}m`);
});

test('normName: strips punctuation, case, and spacing', () => {
  assert.equal(normName('Termas de Lahuen Co'), 'termasdelahuenco');
  assert.equal(normName('Blue  Lagoon!'), 'bluelagoon');
});

test('normName: keeps non-Latin letters rather than emptying the string', () => {
  assert.equal(normName('登別温泉'), '登別温泉');
});

test('normName: null and undefined become empty string', () => {
  assert.equal(normName(null), '');
  assert.equal(normName(undefined), '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/geo.test.mjs`

Expected: FAIL — `Cannot find module ... scripts/lib/geo.mjs`

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/geo.mjs`:

```js
/**
 * Geographic and name-comparison helpers shared across the pipeline.
 *
 * These existed as three separate copies with two different signatures, which
 * is exactly how a 60m rule in one file and a 60m rule in another quietly stop
 * meaning the same thing. One definition, imported everywhere.
 */

const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in metres between two {lat, lng} points. */
export function distanceMeters(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Normalise a name for comparison: lowercase, strip everything that is not a
 * letter or a number in any script.
 *
 * The Unicode property escapes matter. A naive [^a-z0-9] would reduce every
 * Japanese and Arabic name to the empty string, and empty names compare equal
 * to each other, which would merge every unnamed spring in Japan into one.
 */
export function normName(n) {
  return (n || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/geo.test.mjs`

Expected: PASS, 6 tests.

- [ ] **Step 5: Point exclusions.mjs at the shared helper**

In `scripts/lib/exclusions.mjs`, add to the imports at the top of the file:

```js
import { distanceMeters } from './geo.mjs';
```

Delete the entire local `haversine` function (currently lines 42–51, beginning `function haversine(aLat, aLng, bLat, bLng) {`).

Then replace the call site inside `isExcluded`:

```js
      if (distanceMeters(record.location, { lat: e.lat, lng: e.lng }) <= radius) return true;
```

- [ ] **Step 6: Run the full suite to verify nothing regressed**

Run: `node --test "scripts/**/*.test.mjs"`

Expected: PASS, 19 tests (13 existing + 6 new). The two existing privacy tests in `normalize.test.mjs` exercise `isExcluded`, so they cover the swap.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/geo.mjs scripts/geo.test.mjs scripts/lib/exclusions.mjs
git commit -m "refactor: single definition of distance and name normalisation

Three copies of haversine existed with two different signatures. That is how
a 60m threshold in one file and a 60m threshold in another quietly stop
meaning the same thing."
```

---

## Task 2: Move the identity predicate out of the build script

`isSameSpring()` and its helpers currently live in `build-dataset.mjs`. The registry resolver needs the same predicate, and two copies would drift.

**Files:**
- Create: `scripts/lib/identity.mjs`
- Create: `scripts/identity.test.mjs`
- Modify: `scripts/build-dataset.mjs` (delete the moved functions, import them)

- [ ] **Step 1: Write the failing test**

Create `scripts/identity.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { osmType, osmRefOf, isSameSpring } from './lib/identity.mjs';

const at = (lat, lng, name = null, id = 'osm-node-1') => ({ id, name, location: { lat, lng } });

test('osmType reads the element type out of a record id', () => {
  assert.equal(osmType('osm-node-123'), 'node');
  assert.equal(osmType('osm-way-456'), 'way');
  assert.equal(osmType('osm-relation-789'), 'relation');
});

test('osmRefOf converts a record id to an OSM reference', () => {
  assert.equal(osmRefOf('osm-node-123'), 'node/123');
  assert.equal(osmRefOf('osm-relation-789'), 'relation/789');
});

test('identical names merge up to 300m apart', () => {
  const a = at(-39.826478, -71.636675, 'Termas de Lahuen Co', 'osm-node-1');
  const b = at(-39.824, -71.6355, 'Termas de Lahuen Co', 'osm-node-2');
  assert.equal(isSameSpring(a, b), true);
});

test('identical names beyond 300m stay separate', () => {
  const a = at(-39.826478, -71.636675, 'Termas de Lahuen Co', 'osm-node-1');
  const b = at(-39.822813, -71.633676, 'Termas de Lahuen Co', 'osm-node-2');
  assert.equal(isSameSpring(a, b), false);
});

test('a substring name match keeps the tight 60m radius', () => {
  const near = at(64.048, -21.2222, 'Blue Spring', 'osm-node-1');
  // 64.049 is 111m away, unambiguously outside the 60m radius. An earlier
  // draft used 64.0485, which is 55.6m -- inside it -- so the assertion below
  // was wrong and the test would have failed against a correct implementation.
  const far = at(64.049, -21.2222, 'Blue Spring Lodge', 'osm-node-2');
  assert.equal(isSameSpring(near, at(64.0481, -21.2222, 'Blue Spring Lodge', 'osm-node-2')), true);
  assert.equal(isSameSpring(near, far), false);
});

test('one named and one unnamed merge only across different element types', () => {
  const node = at(64.048, -21.2222, 'Reykjadalur', 'osm-node-1');
  const way = at(64.0482, -21.2222, null, 'osm-way-2');
  const otherNode = at(64.0482, -21.2222, null, 'osm-node-3');
  assert.equal(isSameSpring(node, way), true, 'source and pool are one spring');
  assert.equal(isSameSpring(node, otherNode), false, 'two separately mapped nodes are two springs');
});

test('two anonymous records merge only within 12m', () => {
  const a = at(44.6, -110.5, null, 'osm-node-1');
  const close = at(44.60005, -110.5, null, 'osm-node-2');
  const apart = at(44.6003, -110.5, null, 'osm-node-3');
  assert.equal(isSameSpring(a, close), true);
  assert.equal(
    isSameSpring(a, apart),
    false,
    'distinct springs sit metres apart in a geyser basin; merging them deletes real data',
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/identity.test.mjs`

Expected: FAIL — `Cannot find module ... scripts/lib/identity.mjs`

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/identity.mjs`:

```js
/**
 * Durable spring identity.
 *
 * `osm-node-123` is stable only while that OSM node exists. Nodes get deleted
 * and redrawn, and an orphaned claim is a correction somebody lost. Springs
 * therefore carry an id of ours, resolved against a committed registry.
 */
import { distanceMeters, normName } from './geo.mjs';

/** Different element types within this radius are one feature mapped twice. */
export const SAME_FEATURE_METERS = 60;
/** Two anonymous records must be practically on top of each other to merge. */
export const ANONYMOUS_METERS = 12;
/** An identical name this far apart is one destination mapped as several pools. */
export const EXACT_NAME_METERS = 300;

/** 'osm-node-123' -> 'node' */
export function osmType(id) {
  return id.split('-')[1];
}

/** 'osm-node-123' -> 'node/123' */
export function osmRefOf(id) {
  const [, type, num] = id.split('-');
  return `${type}/${num}`;
}

/**
 * Are these two records the same physical spring?
 *
 * Erring toward "no" is the safer failure. A leftover duplicate is visible and
 * fixable; a wrong merge silently deletes a real spring.
 */
export function isSameSpring(a, b) {
  const d = distanceMeters(a.location, b.location);
  const an = normName(a.name);
  const bn = normName(b.name);

  if (an && bn) {
    if (an === bn) return d <= EXACT_NAME_METERS;
    // A substring match is weaker evidence ("Blue Spring" vs "Blue Spring
    // Lodge"), so it keeps the tight radius.
    return d <= SAME_FEATURE_METERS && (an.includes(bn) || bn.includes(an));
  }

  // One named, one not: the source-and-pool case, which shows up as two
  // different element types. Same type means two features somebody mapped
  // individually, so leave them alone.
  if (an || bn) {
    return d <= SAME_FEATURE_METERS && osmType(a.id) !== osmType(b.id);
  }

  return d <= ANONYMOUS_METERS;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/identity.test.mjs`

Expected: PASS, 7 tests.

- [ ] **Step 5: Delete the moved code from the build script**

In `scripts/build-dataset.mjs`, delete these now-duplicated definitions:
- the `SAME_FEATURE_METERS`, `ANONYMOUS_METERS`, and `EXACT_NAME_METERS` constants and their doc comments (currently lines 24–45)
- `function haversine(a, b)` (lines 47–55)
- `function normName(n)` (lines 57–59)
- `function osmType(id)` (lines 61–63)
- `function isSameSpring(a, b)` (lines 71–89, including its doc comment)

Add to the imports at the top of the file, after the existing `exclusions.mjs` import:

```js
import { isSameSpring } from './lib/identity.mjs';
```

That is the only import needed. There is exactly one `haversine(` call site in the
file and it sits inside `isSameSpring`, which moves out wholesale — so afterwards
nothing in `build-dataset.mjs` references `distanceMeters` or `normName`, and
importing them would be dead code. Verify before adding any import: only import
what the file actually references.

- [ ] **Step 6: Verify the build still produces the same dataset**

Run: `node scripts/build-dataset.mjs`

Expected output includes: `merged 1167 duplicate record(s) -> 6471 springs`

If the spring count is not 6471, the move changed behaviour. Stop and diff the predicate against git history rather than accepting a new number.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/identity.mjs scripts/identity.test.mjs scripts/build-dataset.mjs
git commit -m "refactor: move the identity predicate into its own module

The registry resolver needs the same same-spring test the dedupe pass uses.
Two copies would drift, and a drifting identity rule silently splits or merges
springs."
```

---

## Task 3: Mint stable ids and resolve the registry

**Files:**
- Modify: `scripts/lib/identity.mjs`
- Modify: `scripts/identity.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/identity.test.mjs`:

```js
import { mintId, resolveRegistry } from './lib/identity.mjs';

const rec = (id, lat, lng, name, sources = []) => ({
  id,
  name,
  location: { lat, lng },
  sources: sources.length ? sources : [`https://www.openstreetmap.org/${osmRefOf(id)}`],
});

test('mintId is deterministic and prefixed', () => {
  const a = mintId('node/4702109263');
  assert.match(a, /^whs_[0-9a-f]{12}$/);
  assert.equal(a, mintId('node/4702109263'), 'same ref must always mint the same id');
  assert.notEqual(a, mintId('node/4702109264'));
});

test('resolveRegistry mints ids for a first run', () => {
  const records = [rec('osm-node-1', 64.048, -21.2222, 'Reykjadalur')];
  const { registry, assignments, events } = resolveRegistry(records, {}, '2026-08-25');
  const id = assignments.get('osm-node-1');
  assert.match(id, /^whs_/);
  assert.equal(registry[id].osmRefs[0], 'node/1');
  assert.equal(registry[id].firstSeen, '2026-08-25');
  assert.equal(events.filter((e) => e.type === 'spring.appeared').length, 1);
});

test('resolveRegistry reuses an id when the OSM ref is unchanged', () => {
  const records = [rec('osm-node-1', 64.048, -21.2222, 'Reykjadalur')];
  const first = resolveRegistry(records, {}, '2026-08-25');
  const id = first.assignments.get('osm-node-1');
  const second = resolveRegistry(records, first.registry, '2026-09-01');
  assert.equal(second.assignments.get('osm-node-1'), id);
  assert.equal(second.registry[id].firstSeen, '2026-08-25', 'firstSeen must not move');
  assert.equal(second.registry[id].lastSeen, '2026-09-01');
  assert.equal(second.events.filter((e) => e.type === 'spring.appeared').length, 0);
});

test('resolveRegistry keeps the id when OSM redraws the spring under a new ref', () => {
  const before = [rec('osm-node-1', 64.048, -21.2222, 'Reykjadalur')];
  const first = resolveRegistry(before, {}, '2026-08-25');
  const id = first.assignments.get('osm-node-1');

  // Same spring, same name, 40m away, remapped as a way with a brand new id.
  const after = [rec('osm-way-99', 64.0484, -21.2222, 'Reykjadalur')];
  const second = resolveRegistry(after, first.registry, '2026-09-01');

  assert.equal(second.assignments.get('osm-way-99'), id, 'a redraw must not orphan claims');
  assert.ok(second.registry[id].osmRefs.includes('way/99'));
  assert.ok(second.registry[id].osmRefs.includes('node/1'), 'the old ref is retained');
});

test('a spring that vanishes upstream is flagged, never deleted', () => {
  const before = [rec('osm-node-1', 64.048, -21.2222, 'Reykjadalur')];
  const first = resolveRegistry(before, {}, '2026-08-25');
  const id = first.assignments.get('osm-node-1');

  const second = resolveRegistry([], first.registry, '2026-09-01');
  assert.ok(second.registry[id], 'the entry survives');
  assert.equal(second.registry[id].missingSince, '2026-09-01');
  assert.equal(second.events.filter((e) => e.type === 'spring.disappeared').length, 1);
});

test('disappearance is reported once, not on every later build', () => {
  const first = resolveRegistry([rec('osm-node-1', 64.048, -21.2222, 'X')], {}, '2026-08-25');
  const second = resolveRegistry([], first.registry, '2026-09-01');
  const third = resolveRegistry([], second.registry, '2026-10-01');
  assert.equal(third.events.filter((e) => e.type === 'spring.disappeared').length, 0);
  const id = first.assignments.get('osm-node-1');
  assert.equal(third.registry[id].missingSince, '2026-09-01', 'the original date is kept');
});

test('a returning spring clears its missing flag', () => {
  const records = [rec('osm-node-1', 64.048, -21.2222, 'X')];
  const first = resolveRegistry(records, {}, '2026-08-25');
  const gone = resolveRegistry([], first.registry, '2026-09-01');
  const back = resolveRegistry(records, gone.registry, '2026-10-01');
  const id = first.assignments.get('osm-node-1');
  assert.equal(back.registry[id].missingSince, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/identity.test.mjs`

Expected: FAIL — `mintId is not a function` / `resolveRegistry is not a function`

- [ ] **Step 3: Write the implementation**

Append to `scripts/lib/identity.mjs`:

```js
import { createHash } from 'node:crypto';

/**
 * Mint a stable id from an OSM reference.
 *
 * Hash-derived rather than sequential so that ids are reproducible: rebuilding
 * from scratch on another machine assigns the same id to the same spring.
 *
 * 12 hex characters, not 6. Six was measured against the live dataset and
 * produced two real collisions across its 7,638 OSM refs -- node/13322943888
 * and way/1313849089 both minted whs_40cd87 -- an ~82% birthday probability at
 * that scale. Two springs sharing a durable id means claims attaching to the
 * wrong spring, silently and permanently. 48 bits leaves room for the dataset
 * to grow an order of magnitude and stay far below one in ten thousand.
 */
export function mintId(osmRef) {
  return `whs_${createHash('sha256').update(osmRef).digest('hex').slice(0, 12)}`;
}

/** Every OSM reference a record can be traced to, including merged duplicates. */
function refsOf(record) {
  const refs = new Set([osmRefOf(record.id)]);
  for (const src of record.sources || []) {
    const m = src.match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/);
    if (m) refs.add(`${m[1]}/${m[2]}`);
  }
  return [...refs];
}

/** A registry entry rendered as something isSameSpring can compare. */
function asComparable(whsId, entry) {
  const [lng, lat] = entry.centroid;
  const ref = entry.osmRefs[0] || 'node/0';
  const [type, num] = ref.split('/');
  return { id: `osm-${type}-${num}`, name: entry.name, location: { lat, lng }, whsId };
}

/**
 * Assign a durable id to every record and update the registry.
 *
 * Matching order:
 *   1. any OSM ref the record can be traced to
 *   2. isSameSpring against existing entries, which survives a redraw under a
 *      new OSM id
 *   3. mint a new id
 *
 * @returns {{registry: object, assignments: Map<string,string>, events: object[]}}
 */
export function resolveRegistry(records, existingRegistry, today) {
  const registry = structuredClone(existingRegistry);
  const assignments = new Map();
  const events = [];

  const byRef = new Map();
  for (const [whsId, entry] of Object.entries(registry)) {
    for (const ref of entry.osmRefs) byRef.set(ref, whsId);
  }

  const seen = new Set();

  for (const record of records) {
    const refs = refsOf(record);
    let whsId = refs.map((r) => byRef.get(r)).find(Boolean);

    if (!whsId) {
      const candidate = Object.entries(registry)
        .filter(([id]) => !seen.has(id))
        .map(([id, entry]) => asComparable(id, entry))
        .find((entry) => isSameSpring(entry, record));
      whsId = candidate?.whsId;
    }

    if (!whsId) {
      whsId = mintId(refs[0]);
      registry[whsId] = {
        osmRefs: [],
        centroid: [record.location.lng, record.location.lat],
        name: record.name,
        firstSeen: today,
        lastSeen: today,
        missingSince: null,
      };
      events.push({ type: 'spring.appeared', springId: whsId, actor: 'build' });
    }

    const entry = registry[whsId];
    entry.osmRefs = [...new Set([...entry.osmRefs, ...refs])].sort();
    entry.centroid = [record.location.lng, record.location.lat];
    entry.name = record.name ?? entry.name;
    entry.lastSeen = today;
    entry.missingSince = null;

    for (const ref of entry.osmRefs) byRef.set(ref, whsId);
    seen.add(whsId);
    assignments.set(record.id, whsId);
  }

  // Entries nothing matched are flagged, never removed. One plausible cause of
  // an upstream disappearance is a privacy removal we should honour, and a
  // second is a mapper error we should notice. Both need a human.
  for (const [whsId, entry] of Object.entries(registry)) {
    if (seen.has(whsId) || entry.missingSince) continue;
    entry.missingSince = today;
    events.push({ type: 'spring.disappeared', springId: whsId, actor: 'build' });
  }

  return { registry, assignments, events };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/identity.test.mjs`

Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/identity.mjs scripts/identity.test.mjs
git commit -m "feat: stable whs_ ids resolved against a committed registry

Matching falls back from OSM ref to the same-spring predicate, so a spring
redrawn upstream under a new node id keeps its id and its claims. Springs that
vanish upstream are flagged for review rather than deleted -- one plausible
cause is a privacy removal we should honour."
```

---

## Task 4: Deterministic build timestamps

**Files:**
- Create: `scripts/lib/buildtime.mjs`
- Create: `scripts/buildtime.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/buildtime.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildTimestamp, buildDate } from './lib/buildtime.mjs';

function fixture(mtimes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whs-buildtime-'));
  mtimes.forEach((iso, i) => {
    const f = path.join(dir, `tile-${i}.json`);
    fs.writeFileSync(f, '{"elements":[]}');
    fs.utimesSync(f, new Date(iso), new Date(iso));
  });
  return dir;
}

test('SOURCE_DATE_EPOCH wins when set', () => {
  const dir = fixture(['2020-01-01T00:00:00Z']);
  assert.equal(buildTimestamp(dir, { SOURCE_DATE_EPOCH: '1756080000' }), '2025-08-25T00:00:00.000Z');
});

test('falls back to the newest input mtime', () => {
  const dir = fixture(['2026-01-01T00:00:00Z', '2026-08-25T04:00:00Z', '2026-03-01T00:00:00Z']);
  assert.equal(buildTimestamp(dir, {}), '2026-08-25T04:00:00.000Z');
});

test('the same inputs always produce the same timestamp', () => {
  const dir = fixture(['2026-08-25T04:00:00Z']);
  assert.equal(buildTimestamp(dir, {}), buildTimestamp(dir, {}));
});

test('buildDate is the date half of the timestamp', () => {
  const dir = fixture(['2026-08-25T04:00:00Z']);
  assert.equal(buildDate(dir, {}), '2026-08-25');
});

test('an empty input directory throws rather than silently using now()', () => {
  const dir = fixture([]);
  assert.throws(() => buildTimestamp(dir, {}), /no input files/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/buildtime.test.mjs`

Expected: FAIL — `Cannot find module ... scripts/lib/buildtime.mjs`

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/buildtime.mjs`:

```js
/**
 * Deterministic build timestamps.
 *
 * The build previously stamped `new Date()` into every record's `lastVerified`
 * and into the GeoJSON metadata, so a rebuild that changed nothing still
 * produced a 6MB diff touching all 6,470 records. The real change, if any,
 * was invisible inside it.
 *
 * The timestamp is derived from the inputs instead: SOURCE_DATE_EPOCH if the
 * caller sets it (the reproducible-builds convention), otherwise the newest
 * mtime among the raw tiles. Same inputs, same output, byte for byte.
 */
import fs from 'node:fs';
import path from 'node:path';

export function buildTimestamp(rawDir, env = process.env) {
  if (env.SOURCE_DATE_EPOCH) {
    return new Date(Number(env.SOURCE_DATE_EPOCH) * 1000).toISOString();
  }

  const files = fs
    .readdirSync(rawDir)
    .filter((f) => f.startsWith('tile-') && f.endsWith('.json'));

  if (files.length === 0) {
    throw new Error(
      `no input files in ${rawDir}: refusing to fall back to the current time, ` +
        'which would make the build non-reproducible',
    );
  }

  const newest = Math.max(
    ...files.map((f) => fs.statSync(path.join(rawDir, f)).mtimeMs),
  );
  return new Date(newest).toISOString();
}

export function buildDate(rawDir, env = process.env) {
  return buildTimestamp(rawDir, env).slice(0, 10);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/buildtime.test.mjs`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/buildtime.mjs scripts/buildtime.test.mjs
git commit -m "feat: derive build timestamps from inputs, not the clock

A rebuild that changed nothing produced a 6MB diff touching every record,
because lastVerified was stamped from new Date(). Any real change was
invisible inside it."
```

---

## Task 5: Wire deterministic timestamps into the build

**Files:**
- Modify: `scripts/build-dataset.mjs`

- [ ] **Step 1: Import the helper**

Add to the imports in `scripts/build-dataset.mjs`:

```js
import { buildTimestamp, buildDate } from './lib/buildtime.mjs';
```

- [ ] **Step 2: Replace the two clock reads**

At `scripts/build-dataset.mjs:202`, replace:

```js
  const ingestedAt = new Date().toISOString().slice(0, 10);
```

with:

```js
  // Derived from the inputs so the build is reproducible. See lib/buildtime.mjs.
  const ingestedAt = buildDate(RAW_DIR);
  const generatedAt = buildTimestamp(RAW_DIR);
```

Then in the GeoJSON metadata block, replace:

```js
      generated: new Date().toISOString(),
```

with:

```js
      generated: generatedAt,
```

And in the summary object, replace:

```js
    generated: new Date().toISOString(),
```

with:

```js
    generated: generatedAt,
```

- [ ] **Step 3: Verify the build is now reproducible**

Run:

```bash
node scripts/build-dataset.mjs && cp data/hot-springs.json /tmp/whs-a.json
node scripts/build-dataset.mjs && cmp data/hot-springs.json /tmp/whs-a.json && echo REPRODUCIBLE
```

Expected: `REPRODUCIBLE`. If `cmp` reports a difference, something else is still reading the clock — grep for `new Date(` and `Date.now(` in `scripts/`.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-dataset.mjs data/
git commit -m "feat: reproducible build output

Two consecutive builds from identical inputs are now byte-identical, so the
committed dataset diff shows only real changes."
```

---

## Task 6: Make the privacy filter genuinely last

The comment at `build-dataset.mjs:272` claims the privacy guard runs last. `dedupe()` runs after it at line 288. `mergeInto()` adopts the winner's coordinates, so a merge can move a record after it has been cleared.

**Files:**
- Modify: `scripts/build-dataset.mjs`
- Create: `scripts/build.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/build.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isExcluded } from './lib/exclusions.mjs';
import { distanceMeters } from './lib/geo.mjs';

const SOURCE = fs.readFileSync('scripts/build-dataset.mjs', 'utf8');

test('the privacy filter is the last stage that can remove a record', () => {
  const privacyAt = SOURCE.indexOf('isExcluded(');
  const dedupeAt = SOURCE.indexOf('dedupe(records)');
  assert.ok(privacyAt > 0 && dedupeAt > 0, 'both stages must exist');
  assert.ok(
    dedupeAt < privacyAt,
    'dedupe must run BEFORE the privacy filter. mergeInto() adopts the winner ' +
      'coordinates, so a merge after the check can move a record into an ' +
      'exclusion radius that has already been cleared.',
  );
});

test('a merged record is re-checked at its post-merge position', () => {
  // A record cleared at its own position, then merged toward an excluded one.
  const exclusions = { entries: [{ lat: 64.0, lng: -21.0, radiusMeters: 500 }] };
  const beforeMerge = { id: 'osm-node-1', name: 'X', location: { lat: 64.01, lng: -21.0 } };
  const afterMerge = { id: 'osm-node-1', name: 'X', location: { lat: 64.002, lng: -21.0 } };

  assert.ok(distanceMeters(beforeMerge.location, { lat: 64.0, lng: -21.0 }) > 500);
  assert.equal(isExcluded(beforeMerge, exclusions), false);
  assert.equal(
    isExcluded(afterMerge, exclusions),
    true,
    'the post-merge position is inside the radius, so ordering matters',
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/build.test.mjs`

Expected: FAIL on the first test — `dedupe must run BEFORE the privacy filter`.

- [ ] **Step 3: Reorder the stages**

In `scripts/build-dataset.mjs`, move the dedupe block so it runs before the privacy guard. The `main()` body should read, in order:

```js
  // --- Deduplicate ---
  console.log('Deduplicating ...');
  const { records: deduped, dropped } = dedupe(records);
  console.log(`  merged ${dropped} duplicate record(s) -> ${deduped.length} springs`);
  records = deduped;

  // --- The privacy guard. Genuinely last: nothing that can move or add a
  // record may run after this point. ---
  const exclusions = loadExclusions();
  const before = records.length;
  records = records.filter((r) => !isExcluded(r, exclusions));
  const excluded = before - records.length;
  if (exclusions.entries.length) {
    console.log(`  excluded ${excluded} record(s) via the private exclusion list`);
  }
  const leaked = records.filter((r) => r.unicorn !== false);
  if (leaked.length) {
    console.error(`FATAL: ${leaked.length} record(s) carry unicorn !== false. Refusing to write.`);
    process.exit(1);
  }
```

Then change the sort and every later reference from `deduped` to `records`:

```js
  records.sort((a, b) =>
    (a.location.countryName || '').localeCompare(b.location.countryName || '') ||
    (a.name || '￿').localeCompare(b.name || '￿'),
  );
```

and in the outputs section, `JSON.stringify(deduped)` becomes `JSON.stringify(records)`, `deduped.map(` becomes `records.map(`, and each `for (const r of deduped)` becomes `for (const r of records)`. The summary's `total` and the closing `console.log` counts follow the same rename.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/build.test.mjs`

Expected: PASS, 2 tests.

- [ ] **Step 5: Verify the dataset is unchanged**

Run: `node scripts/build-dataset.mjs`

Expected: still `6471 springs across 129 countries`. The reorder is a correctness fix against a hazard, not a behaviour change today — the count moving would mean something else is wrong.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-dataset.mjs scripts/build.test.mjs data/
git commit -m "fix: run the privacy filter genuinely last

The guard's own comment claimed it ran last; dedupe ran after it. mergeInto()
adopts the winner's coordinates, so a merge could move a record into an
exclusion radius after the check had cleared it. Harmless in the current data
and a latent breach of the project's central guarantee. A test now asserts the
ordering."
```

---

## Task 7: Load and validate overlay claims

**Files:**
- Create: `scripts/lib/overlay.mjs`
- Create: `scripts/overlay.test.mjs`
- Create: `data/overlay/.gitkeep`

- [ ] **Step 1: Write the failing test**

Create `scripts/overlay.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLAIMABLE, RISK, validateOverlay } from './lib/overlay.mjs';

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

test('risk tiers track harm: temperature and clothing are high, name is not', () => {
  assert.ok(RISK.high.includes('temperature.celsius'));
  assert.ok(RISK.high.includes('clothing.policy'));
  assert.ok(RISK.high.includes('warnings'));
  assert.ok(RISK.elevated.includes('name'), 'a wrong name misleads; it does not injure');
  assert.ok(RISK.low.includes('hours.open'));
});

test('validateOverlay accepts a well-formed file', () => {
  const errors = validateOverlay({ id: 'whs_a1b2c3d4e5f6', claims: { 'temperature.celsius': claim() } });
  assert.deepEqual(errors, []);
});

test('validateOverlay rejects a non-claimable field', () => {
  const errors = validateOverlay({ id: 'whs_a1b2c3d4e5f6', claims: { 'type': claim({ value: 'resort' }) } });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not claimable/);
});

test('validateOverlay requires a source on every claim', () => {
  const c = claim();
  delete c.source;
  const errors = validateOverlay({ id: 'whs_a1b2c3d4e5f6', claims: { 'temperature.celsius': c } });
  assert.match(errors.join(), /source/);
});

test('validateOverlay rejects an out-of-range temperature', () => {
  const errors = validateOverlay({
    id: 'whs_a1b2c3d4e5f6',
    claims: { 'temperature.celsius': claim({ value: 318 }) },
  });
  assert.match(errors.join(), /between -5 and 130/);
});

test('validateOverlay rejects a malformed id', () => {
  assert.match(validateOverlay({ id: 'osm-node-1', claims: {} }).join(), /whs_/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/overlay.test.mjs`

Expected: FAIL — `Cannot find module ... scripts/lib/overlay.mjs`

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/overlay.mjs`:

```js
/**
 * The curated overlay: authored facts that survive an OSM rebuild.
 *
 * Claims are field-level, never whole-record. That is what lets OSM keep
 * improving the fields nobody has claimed while a claimed field stays
 * protected and its disagreement with upstream becomes a tracked event.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Fields a contributor may assert.
 *
 * Deliberately absent, and why:
 *   type                    drives a safety warning (normalize.mjs:203) and the
 *                           completeness score (normalize.mjs:228), so it is
 *                           pipeline-owned classification. Reclassification is
 *                           a separate human-reviewed operation.
 *   temperature.source      a claim already carries its own source. A second,
 *   temperature.measuredAt  separately claimable provenance field could drift
 *                           from the value it describes, or be overwritten by
 *                           someone who did not submit the reading. Both are
 *                           derived from the temperature claim instead.
 *   location.lat/lng        relocation is how you would defeat the privacy
 *                           radius check.
 *   id, unicorn, quality.*, verified, sources   pipeline-owned.
 */
export const CLAIMABLE = [
  'name',
  'temperature.celsius',
  'access.price',
  'access.currency',
  'access.notes',
  'clothing.policy',
  'clothing.schedule',
  'clothing.notes',
  'hours.open',
  'hours.seasonalNotes',
  'hours.status',
  'description',
  'tags',
  'warnings',
  'location.elevation',
  'location.region',
  'location.nearestTown',
];

/**
 * Risk tiers track physical harm if wrong, not effort to fix. A wrong
 * temperature can burn someone; a wrong name is a discoverability problem.
 *
 * Phase 1 does not enforce these -- there is no review pipeline yet. They live
 * here so the allowlist and the tiers cannot drift apart before phase 2 uses
 * them, and the test asserts every claimable field has exactly one tier.
 */
export const RISK = {
  low: [
    'hours.open',
    'access.price',
    'access.currency',
    'description',
    'tags',
    'location.region',
    'location.nearestTown',
    'location.elevation',
  ],
  elevated: ['name', 'access.notes', 'hours.seasonalNotes', 'hours.status'],
  high: ['temperature.celsius', 'clothing.policy', 'clothing.schedule', 'clothing.notes', 'warnings'],
};

/** Fields that merge rather than replace. Removal is a separate human operation. */
export const ARRAY_FIELDS = ['tags', 'warnings'];

/** @returns {string[]} human-readable errors; empty means valid. */
export function validateOverlay(overlay) {
  const errors = [];

  if (!/^whs_[0-9a-f]{12}$/.test(overlay?.id ?? '')) {
    errors.push(`id must look like whs_a1b2c3d4e5f6, got ${JSON.stringify(overlay?.id)}`);
  }
  if (!overlay?.claims || typeof overlay.claims !== 'object') {
    errors.push('claims must be an object');
    return errors;
  }

  for (const [field, claim] of Object.entries(overlay.claims)) {
    if (!CLAIMABLE.includes(field)) {
      errors.push(`${field} is not claimable`);
      continue;
    }
    if (claim?.value === undefined) errors.push(`${field}: value is required`);
    if (!claim?.source) errors.push(`${field}: source is required on every claim`);
    if (!claim?.contributor) errors.push(`${field}: contributor is required`);

    if (field === 'temperature.celsius') {
      const v = claim?.value;
      if (typeof v !== 'number' || Number.isNaN(v) || v < -5 || v > 130) {
        errors.push(`${field}: must be a number between -5 and 130, got ${JSON.stringify(v)}`);
      }
    }
    if (ARRAY_FIELDS.includes(field) && !Array.isArray(claim?.value)) {
      errors.push(`${field}: value must be an array`);
    }
  }

  return errors;
}

/**
 * Load every overlay file, failing loudly on a malformed one.
 *
 * A parse failure must never degrade to "no claims", which would silently
 * discard authored corrections -- the same reasoning as the exclusion list.
 */
export function loadOverlays(dir) {
  if (!fs.existsSync(dir)) return new Map();
  const overlays = new Map();

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const full = path.join(dir, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      throw new Error(`${full} is not valid JSON: ${err.message}`);
    }
    const errors = validateOverlay(parsed);
    if (errors.length) {
      throw new Error(`${full} is invalid:\n  ${errors.join('\n  ')}`);
    }
    overlays.set(parsed.id, parsed);
  }

  return overlays;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/overlay.test.mjs`

Expected: PASS, 9 tests.

- [ ] **Step 5: Create the overlay directory**

```bash
mkdir -p data/overlay && touch data/overlay/.gitkeep
```

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/overlay.mjs scripts/overlay.test.mjs data/overlay/.gitkeep
git commit -m "feat: overlay claim format, allowlist, and validation

type stays out of the allowlist because it drives a safety warning and the
completeness score. temperature.source and measuredAt stay out because a claim
already carries its own provenance, and a second claimable provenance field
could be overwritten independently of the value it describes."
```

---

## Task 8: Apply claims over derived records

**Files:**
- Modify: `scripts/lib/overlay.mjs`
- Modify: `scripts/overlay.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/overlay.test.mjs`:

```js
import { applyOverlays } from './lib/overlay.mjs';

function record(over = {}) {
  return {
    id: 'whs_a1b2c3d4e5f6',
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
    quality: { provenance: 'osm', completeness: 67, known: [], ingestedAt: '2026-08-25' },
    ...over,
  };
}

const overlay = (claims) => new Map([['whs_a1b2c3d4e5f6', { id: 'whs_a1b2c3d4e5f6', claims }]]);

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
});

test("the claim's source is appended to the record's sources", () => {
  const { records } = applyOverlays([record()], overlay({ 'temperature.celsius': tempClaim }));
  assert.ok(records[0].sources.includes('https://example.org/survey'));
  assert.ok(records[0].sources.includes('https://www.openstreetmap.org/node/4702109263'));
});

test('unclaimed fields still track upstream', () => {
  const { records } = applyOverlays([record()], overlay({ 'temperature.celsius': tempClaim }));
  assert.equal(records[0].hours.open, '24/7', 'untouched by the overlay');
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
  assert.ok(records[0].quality.completeness > before, 'a known temperature raises the score');
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
  assert.deepEqual(orphaned, ['whs_a1b2c3d4e5f6']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/overlay.test.mjs`

Expected: FAIL — `applyOverlays is not a function`

- [ ] **Step 3: Write the implementation**

Append to `scripts/lib/overlay.mjs`:

```js
const FIRST_CLASS_COUNT = 6;

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  const last = parts.pop();
  let target = obj;
  for (const part of parts) target = target[part];
  target[last] = value;
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

/** Mirrors the scoring in normalize.mjs so a claimed field counts as known. */
function recomputeCompleteness(r) {
  const known = [];
  if (r.name) known.push('name');
  if (r.temperature.celsius !== null) known.push('temperature');
  if (r.access.price) known.push('price');
  if (r.clothing.policy !== 'unknown') known.push('clothing');
  if (r.hours.open || r.hours.status !== 'unknown') known.push('hours');
  if (r.type !== 'unknown') known.push('type');
  return { known, score: Math.round((known.length / FIRST_CLASS_COUNT) * 100) };
}

/**
 * Apply active claims over derived records.
 *
 * @returns {{records, applied: number, orphaned: string[]}}
 *   orphaned lists overlay ids with no matching record this build. They are
 *   reported rather than dropped: a claim with nowhere to land is a correction
 *   about to be lost, and the caller decides whether that is fatal.
 */
export function applyOverlays(records, overlays) {
  const byId = new Map(records.map((r) => [r.id, r]));
  let applied = 0;

  for (const [springId, overlay] of overlays) {
    const record = byId.get(springId);
    if (!record) continue;

    for (const [field, claim] of Object.entries(overlay.claims)) {
      if (claim.state !== 'active') continue;

      if (ARRAY_FIELDS.includes(field)) {
        // Merge, never replace. Letting a claim shrink `warnings` would let a
        // contributor strip a scalding notice off a 62C spring.
        const current = getPath(record, field) || [];
        setPath(record, field, [...new Set([...current, ...claim.value])]);
      } else {
        setPath(record, field, claim.value);
      }

      if (field === 'temperature.celsius') {
        record.temperature.fahrenheit = Math.round((claim.value * 9) / 5 * 10 + 320) / 10;
        record.temperature.source = `Curated claim by ${claim.contributor}: ${claim.source}`;
        record.temperature.measuredAt = claim.measuredAt ?? null;
      }

      record.sources = [...new Set([...record.sources, claim.source])];
      applied++;
    }

    const c = recomputeCompleteness(record);
    record.quality.completeness = c.score;
    record.quality.known = c.known;
    record.quality.curated = true;
  }

  const orphaned = [...overlays.keys()].filter((id) => !byId.has(id));
  return { records, applied, orphaned };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/overlay.test.mjs`

Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/overlay.mjs scripts/overlay.test.mjs
git commit -m "feat: apply overlay claims over derived records

Array claims merge and never remove, so a warnings claim cannot strip a
derived scalding notice. Temperature provenance is derived from the claim
rather than claimed separately, so it cannot drift from the value it
describes."
```

---

## Task 9: Detect drift between claims and upstream

**Files:**
- Modify: `scripts/lib/overlay.mjs`
- Modify: `scripts/overlay.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/overlay.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/overlay.test.mjs`

Expected: FAIL — `Cannot read properties of undefined (reading 'filter')`, because `applyOverlays` returns no `events`.

- [ ] **Step 3: Add drift detection**

In `scripts/lib/overlay.mjs`, add the tolerance constant near `ARRAY_FIELDS`:

```js
/**
 * Per-field tolerance for calling two values a disagreement.
 *
 * Temperature gets 0.5C of slack: a thermometer and an OSM tag differing by a
 * fraction of a degree is measurement noise, not a conflict worth a human's
 * attention. Everything else is exact.
 */
const TOLERANCE = { 'temperature.celsius': 0.5 };

function disagrees(field, upstream, claimed) {
  if (upstream === null || upstream === undefined) return false;
  const slack = TOLERANCE[field];
  if (slack !== undefined && typeof upstream === 'number' && typeof claimed === 'number') {
    return Math.abs(upstream - claimed) > slack;
  }
  return upstream !== claimed;
}
```

Then inside `applyOverlays`, capture the upstream value before writing and record the drift. Replace the body of the claim loop so it reads:

```js
    for (const [field, claim] of Object.entries(overlay.claims)) {
      if (claim.state !== 'active') continue;

      const upstream = getPath(record, field);

      if (ARRAY_FIELDS.includes(field)) {
        // Merge, never replace. Letting a claim shrink `warnings` would let a
        // contributor strip a scalding notice off a 62C spring. Merging also
        // means there is nothing to contest.
        setPath(record, field, [...new Set([...(upstream || []), ...claim.value])]);
      } else {
        if (disagrees(field, upstream, claim.value)) {
          // The curated value keeps rendering, so the site never regresses.
          // The disagreement becomes a review item instead.
          events.push({
            type: 'claim.contested',
            springId,
            claimPath: field,
            from: upstream,
            to: claim.value,
            actor: 'build',
          });
        }
        setPath(record, field, claim.value);
      }
```

Declare `const events = [];` at the top of `applyOverlays`, alongside `let applied = 0;`, and add `events` to the returned object:

```js
  return { records, applied, orphaned, events };
```

Update the JSDoc return type to `{{records, applied: number, orphaned: string[], events: object[]}}`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/overlay.test.mjs`

Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/overlay.mjs scripts/overlay.test.mjs
git commit -m "feat: detect drift between claims and upstream

The curated value keeps rendering so the site never regresses; the
disagreement becomes a tracked event. Temperature gets 0.5C of tolerance
because thermometer noise is not a conflict worth a human's attention."
```

---

## Task 10: Append-only event log

**Files:**
- Create: `scripts/lib/events.mjs`
- Create: `scripts/events.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/events.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appendEvents, readEvents } from './lib/events.mjs';

function tmpfile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'whs-events-')), 'events.jsonl');
}

const contested = (to) => ({
  type: 'claim.contested', springId: 'whs_a1b2c3d4e5f6',
  claimPath: 'temperature.celsius', from: 42, to, actor: 'build',
});

test('events are written one JSON object per line', () => {
  const f = tmpfile();
  appendEvents(f, [contested(38)], '2026-08-25T04:00:00.000Z');
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).ts, '2026-08-25T04:00:00.000Z');
});

test('re-running the same build does not duplicate events', () => {
  const f = tmpfile();
  appendEvents(f, [contested(38)], '2026-08-25T04:00:00.000Z');
  appendEvents(f, [contested(38)], '2026-08-25T04:00:00.000Z');
  assert.equal(readEvents(f).length, 1, 'a rebuild must not grow the log');
});

test('a genuinely new state for the same claim is recorded', () => {
  const f = tmpfile();
  appendEvents(f, [contested(38)], '2026-08-25T04:00:00.000Z');
  appendEvents(f, [contested(45)], '2026-09-01T04:00:00.000Z');
  assert.equal(readEvents(f).length, 2);
});

test('history is never rewritten', () => {
  const f = tmpfile();
  appendEvents(f, [contested(38)], '2026-08-25T04:00:00.000Z');
  const before = fs.readFileSync(f, 'utf8');
  appendEvents(f, [contested(45)], '2026-09-01T04:00:00.000Z');
  assert.ok(fs.readFileSync(f, 'utf8').startsWith(before), 'existing lines must be untouched');
});

test('readEvents on a missing file is empty, not an error', () => {
  assert.deepEqual(readEvents(path.join(os.tmpdir(), 'whs-nope', 'events.jsonl')), []);
});

test('a corrupt line fails loudly rather than being skipped', () => {
  const f = tmpfile();
  fs.writeFileSync(f, '{"type":"ok"}\nnot json\n');
  assert.throws(() => readEvents(f), /line 2/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/events.test.mjs`

Expected: FAIL — `Cannot find module ... scripts/lib/events.mjs`

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/events.mjs`:

```js
/**
 * The decision log.
 *
 * Append-only, one JSON object per line, committed. Phase 1 only writes it;
 * the self-improving loop reads it later, once there is enough history to
 * learn from. Instrument now, learn later -- tuning on five observations is
 * superstition with extra steps.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Identity of a claim's *current state*, so a rebuild does not re-report it. */
function stateKey(e) {
  return [e.type, e.springId ?? '', e.claimPath ?? '', JSON.stringify(e.to ?? null)].join(' ');
}

export function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line, i) => {
      if (!line.trim()) return null;
      try {
        return JSON.parse(line);
      } catch (err) {
        // A corrupt log must never be treated as an empty one; that would
        // silently re-report every historical event as new.
        throw new Error(`${file} line ${i + 1} is not valid JSON: ${err.message}`);
      }
    })
    .filter(Boolean);
}

/**
 * Append events that say something new.
 *
 * The build runs repeatedly over unchanged data, so an unconditional append
 * would add the same "contested" line every time until the log dwarfed the
 * dataset. An event is written only when no existing event already records
 * that state for that claim.
 */
export function appendEvents(file, events, timestamp) {
  if (events.length === 0) return 0;

  const existing = new Set(readEvents(file).map(stateKey));
  const fresh = events.filter((e) => !existing.has(stateKey(e)));
  if (fresh.length === 0) return 0;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = fresh.map((e) => JSON.stringify({ ts: timestamp, ...e })).join('\n');
  fs.appendFileSync(file, lines + '\n');
  return fresh.length;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/events.test.mjs`

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/events.mjs scripts/events.test.mjs
git commit -m "feat: append-only event log with replay-safe deduplication

The build runs repeatedly over unchanged data, so an unconditional append
would re-report every contested claim until the log dwarfed the dataset."
```

---

## Task 11: Wire identity and overlay into the build

**Files:**
- Modify: `scripts/build-dataset.mjs`
- Modify: `scripts/build.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `scripts/build.test.mjs`:

```js
test('the build wires identity and overlay between dedupe and the privacy filter', () => {
  const dedupeAt = SOURCE.indexOf('dedupe(records)');
  const identityAt = SOURCE.indexOf('resolveRegistry(');
  const overlayAt = SOURCE.indexOf('applyOverlays(');
  const privacyAt = SOURCE.indexOf('isExcluded(');

  assert.ok(identityAt > dedupeAt, 'identity resolves after dedupe, on final records');
  assert.ok(overlayAt > identityAt, 'claims are keyed by whs_ id, so identity must run first');
  assert.ok(privacyAt > overlayAt, 'the privacy filter still runs last');
});

test('an orphaned claim fails the build rather than being silently dropped', () => {
  assert.match(
    SOURCE,
    /orphaned[\s\S]{0,400}process\.exit\(1\)/,
    'a claim with nowhere to land is a lost correction and must be fatal',
  );
});

test('the shipped dataset uses durable ids', () => {
  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  assert.ok(springs.length > 6000, `expected the full dataset, got ${springs.length}`);
  for (const s of springs.slice(0, 200)) {
    assert.match(s.id, /^whs_[0-9a-f]{12}$/, `${s.id} is not a durable id`);
    assert.ok(Array.isArray(s.osmRefs) && s.osmRefs.length > 0, `${s.id} has no OSM refs`);
  }
});

test('every shipped id is unique', () => {
  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  assert.equal(new Set(springs.map((s) => s.id)).size, springs.length);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/build.test.mjs`

Expected: FAIL — `identity resolves after dedupe` (indexOf returns -1).

- [ ] **Step 3: Add the imports and constants**

In `scripts/build-dataset.mjs`, add to the imports:

```js
import { resolveRegistry } from './lib/identity.mjs';
import { loadOverlays, applyOverlays } from './lib/overlay.mjs';
import { appendEvents } from './lib/events.mjs';
```

and to the path constants near the top:

```js
const REGISTRY = path.join('data', 'registry.json');
const OVERLAY_DIR = path.join('data', 'overlay');
const EVENTS = path.join('data', 'events.jsonl');
```

- [ ] **Step 4: Insert the two stages**

In `main()`, immediately after the dedupe block and **before** the privacy guard, insert:

```js
  // --- Durable identity ---
  // Assign each record an id of ours so a claim survives OSM redrawing the
  // spring under a new node id. Runs after dedupe so ids attach to final
  // records, not to duplicates about to be merged away.
  console.log('Resolving identity ...');
  const priorRegistry = fs.existsSync(REGISTRY)
    ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8'))
    : {};
  const { registry, assignments, events: identityEvents } = resolveRegistry(
    records,
    priorRegistry,
    ingestedAt,
  );
  for (const record of records) {
    const whsId = assignments.get(record.id);
    // Take the refs from the registry rather than from the record id: dedupe
    // folded several OSM elements into this record, and the registry holds all
    // of them. Keeping only the winner's ref would lose the others' matches on
    // the next build.
    record.osmRefs = registry[whsId].osmRefs;
    record.id = whsId;
  }
  const appeared = identityEvents.filter((e) => e.type === 'spring.appeared').length;
  const vanished = identityEvents.filter((e) => e.type === 'spring.disappeared').length;
  console.log(`  ${Object.keys(registry).length} springs in the registry`);
  if (appeared) console.log(`  ${appeared} new since the last build`);
  if (vanished) console.log(`  ${vanished} no longer present upstream (flagged, not deleted)`);

  // --- Curated overlay ---
  console.log('Applying curated claims ...');
  const overlays = loadOverlays(OVERLAY_DIR);
  const { applied, orphaned, events: overlayEvents } = applyOverlays(records, overlays);
  console.log(`  ${applied} claim(s) applied from ${overlays.size} overlay file(s)`);
  const contested = overlayEvents.filter((e) => e.type === 'claim.contested').length;
  if (contested) console.log(`  ${contested} claim(s) now disagree with upstream`);

  if (orphaned.length) {
    // A claim with nowhere to land is a correction about to vanish silently.
    console.error(`FATAL: ${orphaned.length} overlay file(s) reference springs absent from this build:`);
    for (const id of orphaned) console.error(`  ${id}`);
    console.error('Their claims would be silently discarded. Check data/registry.json for a');
    console.error('missingSince flag on these ids before removing the overlay files.');
    process.exit(1);
  }
```

- [ ] **Step 5: Account for claims the privacy filter removes**

The spec requires that every active claim either appears in the output or is
explicitly logged as suppressed. Task 11 Step 4 catches claims whose spring is
absent from the build. This catches the other case: a claimed spring that the
privacy filter removes afterwards. Its claims vanish correctly — the exclusion
wins, always — but they must not vanish *silently*, or a maintainer will never
learn that an overlay file is now dead weight pointing at a protected location.

Immediately after the privacy guard's `leaked` check, insert:

```js
  // Claim accounting. Exclusion always wins, but a suppressed claim must be
  // reported: the overlay file is now dead weight, and it points at a location
  // we have promised to protect.
  const survivingIds = new Set(records.map((r) => r.id));
  const suppressed = [...overlays.keys()].filter((id) => !survivingIds.has(id));
  if (suppressed.length) {
    console.log(`  ${suppressed.length} overlay file(s) suppressed by the privacy filter`);
    console.log('    Remove them from data/overlay/. Their springs are excluded.');
    // Ids only. Never log the claim contents or the matched rule -- a detailed
    // message is an oracle for locating exactly what the exclusion list protects.
    for (const id of suppressed) console.log(`    ${id}`);
  }
```

- [ ] **Step 6: Persist the registry and events**

In the outputs section, after the existing `fs.writeFileSync(OUT_SUMMARY, ...)` line, add:

```js
  fs.writeFileSync(REGISTRY, JSON.stringify(registry, null, 2) + '\n');
  const written = appendEvents(EVENTS, [...identityEvents, ...overlayEvents], generatedAt);
  if (written) console.log(`  ${written} new event(s) recorded in ${EVENTS}`);
```

- [ ] **Step 7: Run the build**

Run: `node scripts/build-dataset.mjs`

Expected:
```
Resolving identity ...
  6471 springs in the registry
  6471 new since the last build
Applying curated claims ...
  0 claim(s) applied from 0 overlay file(s)
...
6471 springs across 129 countries
```

- [ ] **Step 8: Verify reproducibility survived**

```bash
node scripts/build-dataset.mjs && cp data/hot-springs.json /tmp/whs-b.json
node scripts/build-dataset.mjs && cmp data/hot-springs.json /tmp/whs-b.json && echo REPRODUCIBLE
```

Expected: `REPRODUCIBLE`, and the second run reports `0 new since the last build` because the registry now exists.

- [ ] **Step 9: Run the full suite**

Run: `node --test "scripts/**/*.test.mjs"`

Expected: PASS, all tests.

- [ ] **Step 10: Commit**

```bash
git add scripts/build-dataset.mjs scripts/build.test.mjs data/
git commit -m "feat: durable ids and curated claims in the build pipeline

Records now ship whs_ ids with their OSM refs alongside, so a claim survives
OSM redrawing a spring under a new node id. An overlay referencing a spring
absent from the build is fatal: a claim with nowhere to land is a correction
about to vanish silently."
```

---

## Task 12: Prove a claim survives a rebuild

The whole point of the phase. Nothing so far tests it end to end.

**Files:**
- Modify: `scripts/build.test.mjs`

- [ ] **Step 1: Write the test**

Append to `scripts/build.test.mjs`:

```js
import { execFileSync } from 'node:child_process';
import { applyOverlays, loadOverlays } from './lib/overlay.mjs';
import { resolveRegistry } from './lib/identity.mjs';

test('end to end: a claim survives a rebuild and an upstream redraw', () => {
  const springs = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const target = springs.find((s) => s.temperature.celsius === null && s.name);
  assert.ok(target, 'need a spring with no recorded temperature');

  const overlays = new Map([[
    target.id,
    {
      id: target.id,
      claims: {
        'temperature.celsius': {
          value: 38, source: 'https://example.org/survey', measuredAt: '2026-03-14',
          contributor: 'github:tester', state: 'active',
        },
      },
    },
  ]]);

  // Build 1: the claim lands.
  const first = applyOverlays(structuredClone(springs), overlays);
  const claimed = first.records.find((s) => s.id === target.id);
  assert.equal(claimed.temperature.celsius, 38);

  // Build 2: upstream is re-ingested and still knows nothing. The claim holds.
  const second = applyOverlays(structuredClone(springs), overlays);
  assert.equal(second.records.find((s) => s.id === target.id).temperature.celsius, 38);

  // Build 3: OSM redraws the spring under a brand new node id. The registry
  // resolves it to the same durable id, so the claim still finds its home.
  const registry = JSON.parse(fs.readFileSync('data/registry.json', 'utf8'));
  const redrawn = {
    ...structuredClone(target),
    id: 'osm-node-999999999',
    sources: ['https://www.openstreetmap.org/node/999999999'],
  };
  const resolved = resolveRegistry([redrawn], registry, '2026-12-01');
  assert.equal(
    resolved.assignments.get('osm-node-999999999'),
    target.id,
    'a redraw under a new OSM id must not orphan the claim',
  );
});

test('the committed dataset matches the committed inputs', () => {
  const before = fs.readFileSync('data/hot-springs.json');
  execFileSync('node', ['scripts/build-dataset.mjs'], { stdio: 'pipe' });
  assert.ok(
    before.equals(fs.readFileSync('data/hot-springs.json')),
    'data/ is stale: run `npm run data:build` and commit the result',
  );
});
```

- [ ] **Step 2: Run the test**

Run: `node --test scripts/build.test.mjs`

Expected: PASS. If the redraw assertion fails, `isSameSpring` did not match the registry entry — check that the registry centroid is stored as `[lng, lat]` and read back in that order in `asComparable`.

- [ ] **Step 3: Commit**

```bash
git add scripts/build.test.mjs
git commit -m "test: prove a claim survives a rebuild and an upstream redraw

This is the phase's whole purpose and nothing tested it end to end. Also
asserts the committed dataset matches the committed inputs, so a stale data/
directory fails rather than confusing the next reader."
```

---

## Task 13: Update the schema, scripts, and documentation

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `package.json`
- Modify: `docs/DATA.md`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Update the TypeScript record type**

In `src/lib/types.ts`, replace the `id` field and its comment in the `HotSpring` interface:

```ts
  /**
   * Durable id, stable across rebuilds and across OSM redrawing the spring
   * under a new element id. Claims in data/overlay/ are keyed by it.
   */
  id: string;
  /** Every OSM element this record was derived from, e.g. ["node/4702109263"]. */
  osmRefs: string[];
```

And in `DataQuality`, add:

```ts
  /** True when at least one curated claim was applied to this record. */
  curated?: boolean;
```

- [ ] **Step 2: Verify the app still typechecks and builds**

Run: `npx tsc -b --force`

Expected: exit 0, no output.

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 3: Update the test script to discover all test files**

In `package.json`, replace the `test` script:

```json
    "test": "node --test \"scripts/**/*.test.mjs\"",
```

Run: `npm test`

Expected: all tests pass. The quoted glob is matched by Node itself, so it works the same in bash and in cmd.

- [ ] **Step 4: Document the overlay in docs/DATA.md**

Insert a new section immediately before `## Stage 4 — privacy filter`:

```markdown
## Stage 3c — durable identity and the curated overlay

The dataset is derived, so a correction used to survive exactly until the next
ingest. Two stages fix that, both running after dedupe and before the privacy
filter.

**Identity.** Each record gets a `whs_` id from `data/registry.json`, resolved by
OSM ref first and by the same-spring predicate second. That fallback is what
keeps a claim attached when OSM deletes a node and redraws the spring as a way.
Registry entries that match nothing are flagged `missingSince` and emit
`spring.disappeared` — never deleted, because one plausible cause of an upstream
disappearance is a privacy removal we should honour.

**Overlay.** `data/overlay/<id>.json` holds field-level claims. Claims override
derived values; unclaimed fields keep tracking OSM. Array fields merge and never
remove, so a claim cannot strip a derived scalding warning. `temperature.source`
and `temperature.measuredAt` are derived from the temperature claim's own
metadata rather than being separately claimable, so provenance cannot drift from
the value it describes.

When an active claim disagrees with upstream, the curated value keeps rendering
and a `claim.contested` event is appended to `data/events.jsonl`. Temperature
allows 0.5 °C of tolerance; everything else is exact.

An overlay file naming a spring absent from the build is a **fatal error**. A
claim with nowhere to land is a correction about to vanish silently.

### Reproducibility

The build is byte-for-byte reproducible from committed inputs. Timestamps come
from the newest raw tile mtime, or `SOURCE_DATE_EPOCH` when set — never the
clock. Before this, every rebuild rewrote `lastVerified` on all 6,470 records
and buried any real change in a 6 MB diff.
```

- [ ] **Step 5: Document the claim format in CONTRIBUTING.md**

Append:

```markdown
## Correcting a record

The best correction is usually an edit to OpenStreetMap, which flows into the
next build and helps every project using the same data.

When the correction is specific to this dataset, add a claim. Create
`data/overlay/<spring-id>.json`, using the `whs_` id shown in the detail card:

```json
{
  "id": "whs_a1b2c3d4e5f6",
  "claims": {
    "temperature.celsius": {
      "value": 38,
      "source": "https://example.org/where-you-got-this",
      "measuredAt": "2026-03-14",
      "contributor": "github:yourname",
      "state": "active"
    }
  }
}
```

Every claim needs a `source` a stranger can check. "I was there last week" is
useful context but cannot be the only citation.

Some fields are deliberately not claimable. `type` drives a safety warning and
the completeness score, so reclassification is reviewed by a person.
`temperature.source` and `temperature.measuredAt` are derived from the
temperature claim itself. Coordinates are not claimable at all, because moving a
spring is how you would defeat the privacy exclusion radius.

`tags` and `warnings` merge — a claim adds entries and never removes them.
Removing a derived safety warning is a separate, human-reviewed operation.

Run `npm test` before submitting; the overlay validator will tell you exactly
what is wrong.
```

- [ ] **Step 6: Run everything**

```bash
npm test && npm run data:build && npx tsc -b --force && npm run build
```

Expected: tests pass, build reports `6471 springs`, typecheck clean, bundle built.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts package.json docs/DATA.md CONTRIBUTING.md data/
git commit -m "docs: overlay claim format, durable ids, and reproducibility

Records now carry whs_ ids and osmRefs. CONTRIBUTING explains the claim format
and why type, temperature provenance, and coordinates are not claimable."
```

---

## Done when

- `npm test` passes with every suite green
- `node scripts/build-dataset.mjs` twice in a row produces byte-identical output
- `data/registry.json` holds ~6,471 entries and every shipped record has a `whs_` id
- A claim in `data/overlay/` overrides its derived field, and disagreement with upstream appends `claim.contested` to `data/events.jsonl`
- An overlay naming an unknown spring fails the build
- The privacy filter is the last stage that can remove a record, asserted by a test
- The app typechecks and builds

## Deliberately not in this phase

Contribution gates, GitHub Actions, the LLM manager, trust levels, `_proposed/` new-spring files, `reclassify` and `retract` operations, and the drift review queue. `RISK` ships as data with a test keeping it consistent with the allowlist, but nothing enforces it until phase 2 has a reviewer to enforce it for.

---

## Follow-up recorded during execution

**Registry fallback is O(n²).** Task 3's fallback scans every registry entry for
each record that does not match by OSM ref. Measured against the real 6,471
records:

| Path | Time |
|---|---|
| Steady-state rebuild (everything matches by ref) | **31 ms** |
| Cold bootstrap (empty registry) | 4.45 s |
| Worst case (every ref changes at once, e.g. a mass upstream re-import) | 12.8 s |

31 ms is what the routine path actually costs, so this is not urgent and was
deliberately not optimised during phase 1. It should be bounded — spatial
bucketing by geohash prefix, reusing the grid approach `dedupe()` already uses —
before the build is CI-gated in phase 2, and before the dataset grows another
order of magnitude.

**`mintId` length.** Fixed during execution rather than deferred. Six hex
characters produced two real collisions across the live dataset's 7,638 OSM
refs (~82% birthday probability). Now 12 hex characters plus a mint-site
assertion that throws naming both refs, so a future collision is loud rather
than silent.
