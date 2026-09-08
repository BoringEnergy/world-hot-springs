# NCEI stage two — what gets admitted to the atlas

Decided 2026-09-08. Status: accepted with three amendments. Not implemented.

Stage one merged NOAA's Thermal Springs List as a second upstream and filled
119 temperatures on springs the atlas already held
(`2026-09-06-ncei-upstream-design.md`). It deliberately added no records. This
settles what stage two may add.

**1,506 NCEI rows match nothing in the atlas**, at a median 43 km from the
nearest record, with only 109 within 1 km. They are not coordinate drift; they
are American springs the atlas does not contain.

---

## Decision 1 — Fumaroles, mud pots, steam vents and non-bathable geysers stay out

**Accepted.**

This is an atlas of places a person might enter, or reasonably think they
could. That is already encoded in PRIVACY.md, in the card model (price,
clothing, hours, soak warnings) and in the temperature filter. NOAA's list is a
geothermal-feature gazetteer — every surface hydrothermal feature at 20 °C or
above. Importing it whole would turn a hot-springs atlas into a 1981
hydrothermal inventory with a globe on top.

| Feature | New record? | Why |
|---|---|---|
| Spring / pool, soak-plausible | Eligible, see decision 3 | The product |
| Fumarole, steam vent, gas vent | No | No water body to enter |
| Mud pot, mud volcano, paint pot | No | A view feature |
| Geyser with no enterable pool | No | Already excluded by PRIVACY.md |
| Mixed site already in the atlas | Keep, do not duplicate | It earned its pin before NOAA arrived |

No parallel "geothermal features" layer. That is a different product with a
different promise.

Stage-one enrichment is untouched: where a fumarole-named row already matched
an atlas spring, its temperature stays. The spring earned its pin on its own.

### Amendment: the classifier is head-noun plus water-word, never substring

The committed TSV has no type column, so this is name-only classification and
will miss some. Under-importing is the right error. But the lexicon as first
drafted is wrong in **both** directions, and the data says so:

**It misses features it means to reject.** `GEYSER` and `SOLFATARA` were not on
the list. `MUD POTS` and `STEAM VENTS` appear as two words and a single-token
lexicon does not see them.

**Substring matching would reject real springs.** Measured against the actual
rows: `STEAMBOAT SPRINGS` contains "STEAM", `WHITE SULPHUR SPRINGS` contains
"SULPHUR", and `FORT BIDWELL HOT SPRING` contains "WELL" inside "BIDWELL".

The rule is therefore: a row is view-only when its name carries a view-only
feature word **as a whole word** *and* carries no water word.

```js
const VIEW  = /\b(FUMAROLE|FUMAROLES|GEYSER|GEYSERS|MUDPOT|MUDPOTS|MUDKETTLE|
                 PAINTPOT|PAINTPOTS|SOLFATARA)\b
              |\b(MUD|STEAM|GAS|PAINT)\s+(POT|POTS|VENT|VENTS|VOLCANO|
                 VOLCANOES|CAVE|CAVES)\b/i;
const WATER = /\b(SPRING|SPRINGS|POOL|POOLS|LAGOON|BATHS?|HOT\s+WELLS?)\b/i;
```

The water clause is what earns its place. It rejects 53 rows and **saves 13
that a naive lexicon would have wrongly dropped**: `HOT SPRINGS NEAR GEYSER
BIGHT`, `GEYSER WARM SPRING`, `BEOWAWE HOT SPRINGS (THE GEYSERS)`, `GEYSER
RANCH SPRINGS`, `CASA DIABLO HOT SPRINGS AND GEYSER`. A name that claims a
spring is soak-class even when it also mentions the geyser next door.

---

## Decision 2 — No new pins inside a no-bathing park, and no group/vent collapse

**Accepted, including the generalisation.**

The two datasets are different grains. NOAA lists named groups
(`BLACK WARRIOR GROUP, SHELF SPRING`); the atlas lists individual vents. Stage
one already chose the only safe merge rule — ambiguity is a rejection — and
that was right.

Adding groups as extra pins on top of vents would double-count the park and
imply new soak destinations in a place the atlas documents as view-only,
soaking prohibited, water that has killed people. That is a safety lie, not a
granularity nit. Collapsing vents up to groups would destroy durable `whs_`
ids and every claim attached to one.

Unmatched rows inside such a boundary go to a public, arguable bucket. They do
not become records. A site hierarchy — basin / group / vent — is its own spec
and is not a prerequisite for the rest of the American gap. Existing OSM
Yellowstone vents stay; removing them is a separate decision.

**The generalisation is the important half**: key the rule on
`access.bathingAllowed === false`, not on the string "Yellowstone". Today that
is one manager and 44 rows; the rule should hold for the next one without a
code change.

### Amendment: read the manager list, not the record

The rule cannot consult a record's `access.bathingAllowed`, because at the time
stage two runs, nothing has set it. The NCEI stage sits at
`build-dataset.mjs:279` and `applyLandManagers` at `:397` — 118 lines and four
stages later. Reading the flag off a record would test a field that is still
`null` on every one, and silently admit every park row.

Instead, load `data/land-managers.json` directly and test the candidate
coordinate against the bbox of every manager whose `access.bathingAllowed` is
`false`. Same flag, same intent, sourced from the config rather than from a
record that has not been stamped yet. `loadLandManagers()` and the bbox
containment test already exist and are pure.

---

## Decision 3 — NOAA is enough provenance; it is not enough admission

**Accepted.** Provenance was settled in stage one: NCEI is a second upstream,
pinned by URL, DOI and sha256, CC0, reviewable as text, and Gate 2 never sees
it. Admission is the separate, product question.

A NOAA-only row earns a public pin when **all** of these hold:

1. **Soak-class** under decision 1.
2. **A real name.** `BARANOF WARM SPRINGS` passes. `HOT SPRINGS`, `WARM
   SPRING`, `SEEP`, `SPRING` do not — those are coordinates wearing a type.
3. **Coordinates at 3 decimal places or better** (~110 m). 2 dp is ~1.1 km and
   1 dp is ~11 km; a pin that sloppy is how somebody walks into the wrong pool.
4. **Outside every `bathingAllowed: false` boundary**, per decision 2.
5. **Still last through the privacy filter.** Radius exclusions win. A NOAA hit
   is never a reason to punch a hole in an exclusion.
6. **Published as historical and unverified**: `verified: false`,
   `temperature.measuredAt` of `1981` where a reading exists, the DOI in
   `sources`, and a derived warning stating that the reading *and the existence
   of the spring* come from a 1981 compilation and have not been checked on the
   ground.

Everything failing 1–4 goes to a public quarantine with its reason attached,
never deleted — the same posture as `known-bad-imports.json`, because calling a
row unfit is a claim and must be arguable.

Criterion 5 needs no work: the NCEI stage already runs above the privacy
filter, so anything it adds passes through the exclusion check like any other
record. That ordering is asserted by a test.

### Correction: the admitted set is about 1,031, not "hundreds"

Measured, not estimated:

```
1506  unmatched NCEI rows
  53  rejected: view-only feature                 -> 1453
 137  rejected: generic or absent name            -> 1316
 241  rejected: coordinates coarser than 3 dp     -> 1075
  44  rejected: inside a no-bathing boundary      -> 1031

ADMISSIBLE 1031  (68% of unmatched; 968 carry a numeric temperature)
by state: CA 198, NV 192, ID 164, OR 96, UT 88, AK 55, NM 54, MT 48, CO 35, AZ 32
```

The four filters reject 32%, not the bulk. That is not a fault in the criteria;
it is what the source is. NOAA's list is mostly named, mostly precise, and
mostly outside national parks.

**This is a 16% increase in the size of the atlas** — 6,467 to roughly 7,500 —
and it roughly doubles the American count. Every new pin is a 1981 record never
checked on the ground, many in wilderness. That is a real product change and
should be a deliberate one rather than a consequence.

Tightening further would require an arbitrary cut, and an arbitrary cut is
worse than a large honest number. Recommend admitting the 1,031 with criterion
6's labelling doing the work it is there to do.

---

## Two prerequisites the decisions do not mention

**The provenance guard forbids an NCEI-only record.** `build.test.mjs:221`
asserts every published record's provenance includes `osm` — added during
stage one, when that was true of everything. A NOAA-only record has provenance
`['ncei']` and fails it. The guard must be amended in the same change that
admits the first such record, and amended precisely: keep the known-provider
set and the no-duplicates rule, drop only the OSM requirement.

**Durable identity already works, which is better than expected.**
`mintId({provider, externalId})` namespaces every non-OSM provider, so an NCEI
row mints a stable, collision-safe `whs_` id with no new machinery. `sourceRefs`
is already the authored shape and `osmRefs` already a projection of it. The
compatibility seam is deliberate and documented: an OSM ref is hashed bare so
the 6,467 existing ids do not move. Stage two mints from
`{provider: 'ncei', externalId: <row key>}` and gets namespacing for free.

The row key needs choosing, and it must be stable across a re-fetch. The mirror
has no id column, so a candidate is `state/lat/lng` as printed in the TSV —
stable because the file is pinned by hash and regenerated deterministically.

---

## What this means for the 1,506

| Bucket | Fate | Count |
|---|---|---|
| Already matched, stage one | Untouched | 128 |
| View-only by name | Rejected, kept in the report | 53 |
| Generic or absent name | Quarantined | 137 |
| Coarser than 3 dp | Quarantined | 241 |
| Inside a no-bathing boundary | Deferred, no pin | 44 |
| Named, precise, soak-class, outside no-bath parks | **Admit, unverified** | **1031** |
| Hits an exclusion radius | Dropped last, as always | unknown by design |
