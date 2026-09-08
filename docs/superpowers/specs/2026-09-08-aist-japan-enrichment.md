# AIST as a third upstream — Japanese enrichment

Written 2026-09-08. Status: scope accepted, **two blockers and one open question
before implementation**.

## Scope, settled

**Enrichment only.** Attach temperature and chemistry to springs the atlas
already holds. Do not mint pins from the 4,340 AIST rows that sit more than
5 km from anything.

The reasons are stronger than they were for NCEI. AIST is a wellhead chemistry
gazetteer — 7,203 泉源 across 4,280 温泉名 — not a visitor atlas. OSM already
names the facility, which is the object this product maps. And the 190 m cell
below makes a new pin an invented location. Japan is not the American gap: the
empty field here is `minerals.*`, not the map.

Admission is a separate product change with a privacy question attached and
must not be smuggled into an enrichment diff.

## The source

    file    GSJ_DB_GRES-DB_ONSEN_2020.zip  (817,114 bytes)
    sha256  09ceca4ebf6a4ba366c6093845f190b95e2fd3a2ad7c7d97f0ac074bc4a68cab
    at      https://gbank.gsj.jp/gres-db/download/onsen/GSJ_DB_GRES-DB_ONSEN_2020.zip
    holds   GSJ_DB_GRES-DB_ONSEN_2020.csv, 3,915,661 bytes, Shift_JIS
    licence 政府標準利用規約 第2.0版, stated CC BY 4.0 compatible, attribution
            required, commercial use permitted

7,203 rows, 82 columns. `fetch-ncei.mjs`'s `unzip()` reads it unchanged — an
`.xlsx` and this `.zip` are the same container. Two additions are needed: a
Shift_JIS decode, and a real CSV parser, because `位置` holds WKT geometry
containing commas and a naive `split(',')` shifts every column after it.

## Blocker 1 — the analyses are not 2020, and I said they were

I reported this dataset as 2020 vintage needing no historical machinery. That
was the compilation year. The analyses themselves:

    earliest 1910 | median 1975 | latest 2005
    1950s 788 · 1960s 979 · 1970s 1037 · 1980s 774 · 1990s 717 · 2000s 204
    no date at all: 2,692 of 7,203 (37%)

The median analysis is **older than NOAA's uniform 1981**, and unlike NOAA the
dates are heterogeneous and often absent. So `measuredAt` is not optional
polish here, it is the whole honesty mechanism, and the undated third is the
awkward case.

The UI already models exactly this. `DetailPanel`'s minerals card says
`measuredAt` separates "the source states it was analysed on this date" from
"the source published figures without saying when", and its own comment notes
that an undated analysis may be decades old. That is this dataset described in
advance.

`採水年月日` is a decimal year (`1978.5`), not an ISO date. Take the integer
year as a string; do not invent a month.

## Blocker 2 — the chemistry is in two different units

    mg/kg  5,129 rows
    mg/l   1,766 rows
    empty    307 rows
    "0.0002"   1 row  (garbage in the unit column)

The schema's `minerals.tds` is documented as mg/L. **71% of rows are mg/kg.**
Converting needs the solution density — `比重` is present — and computing a
published value is what rule 2 forbids. Writing mg/kg into a field that means
mg/L is worse: silently wrong, and unfalsifiable from the record.

Three ways out, none free:

1. **Import chemistry only from the 1,766 mg/l rows.** Honest and small. Cuts
   the mineral yield to roughly a quarter before matching is applied.
2. **Import all, and record the unit in `minerals.notes` verbatim.** Keeps the
   yield, but a reader comparing two springs is comparing two units unless they
   read the note, and the numeric fields are then not commensurable — which is
   the one thing a numeric field is for.
3. **Temperature only in this change; chemistry in its own spec.** `泉温` is °C
   in every row and has no unit problem at all.

**Recommend 3.** Temperature is unambiguous, ships now, and proves the whole
pipeline. Chemistry is the larger prize and deserves a decision about units
rather than a footnote inside a temperature change.

## Open question — the yield rests on short names

Measured against the real data, at the agreed 200 m gate:

    350  atlas springs with >=1 AIST row within 200 m
    242  clean 1:1 (108 contended)
    121  ...names agree, plain containment against 温泉名 or 泉源名
    130  ...names agree, after stripping 温泉 旅館 ホテル 荘 の湯

The strip rule adds 9, and they are real: `茂岩温泉 ← 茂岩・盃`,
`新鳩ノ湯温泉 ← 新鳩の湯`, `秩父温泉 満願の湯 ← 秩父満願の湯`,
`天然温泉 平和島 ← 平和島温泉`. Adopt it.

**But 91 of those 130 rest on a stripped name of three characters or fewer.**
Only 20 rest on a longer one. 5,062 of 12,015 stripped AIST names are two
characters (`静翠`, `羅臼`, `花山`, `白樺`, `弘法`).

`identity.mjs` has already decided this question for dedupe, and decided it the
other way. `MIN_SUBSTRING_NAME_LENGTH = 4` exists with a written argument: a
short CJK name is a complete name rather than a fragment, so it stays eligible
for substring matching — but only within `ANONYMOUS_METERS` (12 m), because
"at a few metres apart, near-coincident position supplies the identity evidence
the short name can't; at tens of metres, it's coincidence."

This change would accept the same evidence at **200 m**, in a country where
onsen cluster, against a source whose position is a 190 m cell. That is looser
than the standard the repository already argued for, and it carries the yield:

| rule | matches |
|---|---|
| Accept short names at 200 m | **130** |
| Apply `MIN_SUBSTRING_NAME_LENGTH` as dedupe does | **~20** |

That is the difference between a worthwhile change and a marginal one, and it
is a judgement about evidence, not a threshold to tune. It needs deciding
before implementation, not during.

A middle option worth considering: require a short name to agree on **both**
`温泉名` and `泉源名`, or require the atlas name to be long even when the AIST
one is short. Neither is measured yet.

## Contention — correct, and nearly worthless

The rule stands: group AIST rows sharing a `温泉名`, match the group to at most
one spring, and write a numeric field only when the wells agree. Never average,
never take the nearest well — that computes a claimed value.

Measured, the recovery is almost nil:

    108  contended springs
      7  temperatures agree within 1 C     (99 disagree, field withheld)
     11  pH agree within 0.1               (63 disagree, field withheld)

The wells genuinely differ — different depths, different sources under one
onsen name. So contention handling is worth implementing for correctness and
for the report, but it should not be justified by yield: it buys about seven
temperatures. Recovering the rest is a hierarchy spec.

`temperature.kind` is `source`: AIST publishes 泉温 at the wellhead.

## Schema work, and a defect already on main

**`SourceProvider` is still `'osm'` alone**, and `provenance` is typed
`SourceProvider[]`. The shipped dataset already contains `ncei`, so **the type
is a lie on `main` today** — stage two introduced it and `tsc` cannot catch it,
because `useStore` fetches the GeoJSON at runtime and nothing validates the
payload against the type. Widen to `'osm' | 'ncei' | 'aist'` and fix the
existing untruth in the same change.

**`minerals.potassium` does not exist** and `K` is present in 6,842 AIST rows.
Do not add the field in the change that first writes minerals — that is the
two-PR schema rule. Land the field empty first, or leave K out.

`泉質` does not map cleanly to `MineralType`. The values are free text with
variants — `単純` / `単純温泉` / `アルカリ性単純` / `アルカリ性単純温泉`,
`Na-Cl泉`, `放射能泉`, `単純硫黄泉` — and 3,019 rows are empty. A lookup table
is required and it is a judgement exercise; it belongs with the chemistry spec,
not here.

## The 190 m cell

Every one of the 7,203 polygons is 187–191 m across. That is a publisher
choice, not GPS scatter.

| use | allowed |
|---|---|
| Centroid as a distance key to an already-located spring | yes |
| Writing the centroid to `location.lat` / `location.lng` | no |
| Admitting a new pin at the centroid | no |
| Publishing the cell as a footprint | not in the schema; not here |

Enrichment never un-fuzzes anything a reader can click: the pin stays where OSM
put it and the chemistry rides along. That is precisely why enrichment is
privacy-safe and admission is not. A 190 m cell in a mountain valley is enough
to put a pin on the wrong ravine.

## Placement

Same slot as NCEI enrichment: after identity, before the curated overlay, above
the privacy filter. An authored claim beats AIST. Admission's placement above
`dedupe()` is irrelevant here because nothing is created.

## What ships, if the open question resolves toward 130

- `temperature.celsius` as printed, `kind: source`, `measuredAt` the stated
  year, `temperature.source` citing AIST/GSJ and the dataset title
- `quality.provenance` gains `aist`
- Attribution in `DATA.md`, per the licence
- A match report naming every withheld field and why

Roughly 130 temperatures, plus about 7 recovered from agreeing contended
groups. For scale, Iceland, Russia, Turkey and Chile together produced 17.

## Deferred

Chemistry and the unit decision. `minerals.potassium`. The 泉質 lookup. Any
site hierarchy. Admission of the 4,340 distant rows. An alias file to recover
named misses — curation, not a matcher change.
