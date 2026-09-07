# NCEI as a second upstream — design

Written 2026-09-06. Status: approved, not implemented.

## The problem

The United States is the largest gap in the atlas and the emptiest. Of 1,830
American springs, **1,764 cite nothing but OpenStreetMap** and 12 carried a
temperature before this work began. Gate 2 verifies a claim by re-fetching the
page it cites and checking the number literally appears there; when a spring
cites no page, there is nothing to verify and no claim can be made.

An earlier pass established that this is *not* a units problem. Every US
operator website in the atlas was sampled — 55 pages. Eighteen failed to fetch,
32 published no temperature, five carried a figure, and four of those would
verify. Adding a claimable `temperature.fahrenheit` field would have bought two
or three claims for a permanent widening of the claimable surface. It was
rejected on those numbers.

The gap is source coverage, and closing it needs a source.

## The source

**Thermal Springs List for the United States**, NOAA NCEI accession 0303600,
DOI [10.25921/c8p0-zs06](https://doi.org/10.25921/c8p0-zs06). Compiled 1981 by
DOE Los Alamos National Laboratory. 1,661 rows across 23 states, every natural
surface hydrothermal feature at 20 °C or above — springs, pools, mud pots, mud
volcanoes, geysers, fumaroles and steam vents.

    file    NCEI-thermal-springs.xlsx  (338,181 bytes)
    sha256  bb3e65d8fbf34d25b6e6d071f86dc5d67f68ee022d55ff7aac428d29283d351c
    at      https://www.ncei.noaa.gov/data/oceans/archive/arc0238/0303600/
            1.1/data/0-data/geothermal_database/data/NCEI-thermal-springs.xlsx
    licence CC0-1.0 Public Domain Dedication (stated in the ISO 19115 record)

**It publishes both °F and °C**, so no value is ever computed. Rule 2 — never
compute a claimed value — is satisfied by taking the °C column as printed.

Two properties of this source drive most of the design:

**It is frozen.** "Not Updated since 1980. Product has been decommissioned from
NCEI websites as of May 5, 2025." A dataset that has already been retired once
must not be a live dependency of the build.

**It is 45 years old**, and it feeds a field where being wrong burns someone.

## What the data actually contains

Measured, not assumed. The parse recovers 1,661 rows, which is the count the
file's own header states; that agreement is the parse's proof.

| | rows |
|---|---|
| Numeric °F/°C pair, internally consistent | 1,479 |
| Qualitative only — `H` hot (109), `W` warm (69), `B` boiling (1) | 179 |
| Mis-sliced by the first parser (names containing digits) | 3 |

Coordinate precision: 1,366 rows at 3 decimal places (~110 m), 257 at 2 dp
(~1.1 km), 37 at 1 dp, 1 at 0 dp.

**An `.xlsx` is a zip of XML and needs no dependency to read** — roughly thirty
lines for shared strings plus one sheet. Two traps, both hit during
measurement and both worth a test: self-closing `<c r="B6" s="1"/>` cells carry
no value and will swallow the next populated cell if the regex is lazy, and a
spring name may span several cells, so columns cannot be indexed positionally
from the left.

## The finding that set the scope

Distance from each NCEI row to the nearest spring in the atlas:

```
<=  200 m :  153  (9.2%)
<=  500 m :  224  (13.5%)
<= 1000 m :  262  (15.8%)
>  5000 m : 1314  (79%)
```

**The two datasets are almost disjoint.** Four-fifths of NOAA's springs are
more than 5 km from anything the atlas holds. By state: Wyoming 24%, Colorado
19%, Idaho 15%, Nevada 12%, California 5%, Alaska 2%; Hawaii, Virginia, Texas,
Georgia, Arkansas, West Virginia, Florida, South Dakota, Massachusetts, North
Carolina and New York match nothing at all.

This was checked for a systematic error and is real: matches inside 200 m are
convincing pairs (`Artists Paintpots` → `Artists' Paintpots`, 164 m;
`Bijah Spring` → `Bijah Springs`, 75 m). Where both sides are named and within
200 m, **70% share a name**; agreement decays to 63% by 500 m and 59% by 1 km.

So enrichment is the small half — about 150 temperatures. The other ~1,300 rows
are springs the atlas does not have, and they are the larger prize.

**This design covers enrichment only.** Adding records is deferred to a second,
separately reviewable change. The ingest, parse, match rule and provenance work
are identical either way; creating 1,300 records is the risky part and deserves
its own diff rather than arriving inside a change justified as enrichment.

## Trust model

NCEI is a **second upstream, peer to OpenStreetMap — not a contributor claim.**

Gate 2 exists because contributors are untrusted. An upstream the maintainer
chose and reviewed is a different trust class, and the repository already has
that class: nobody verifies each OSM temperature tag, and `quality.provenance`
is an array because more than one upstream was anticipated.

Routing NOAA through the per-claim gate was considered and rejected. The only
way to do it is to mirror the table and have each claim cite the mirror, and
then `valueAppears` becomes vacuous: a 1,661-row table contains nearly every
plausible temperature, so the check passes regardless of which spring the claim
concerns. That is the failure the handoff already records — `valueAppears(39,
…)` matching `WhatsApp +354 777 39 35` — promoted from an edge case to the
normal case. A green tick that means nothing is worse than no tick.

What replaces verification is **reviewability**: a pinned URL, a committed
content hash, and a match report a human can read.

## Placement

```
fetch → normalize → quarantine → dedupe → durable identity
      → NCEI merge          <-- here
      → curated overlay → privacy filter → output
```

Two existing rules force this position, and both are correctness properties
rather than preferences:

- **Above the privacy filter.** The filter is last and a test asserts it,
  because proximity matching can relocate a record.
- **Before the curated overlay.** An authored claim must beat NOAA rather than
  race it.

## Components

| Path | Purpose |
|---|---|
| `data/reference/ncei-thermal-springs.tsv` | Committed text mirror with a provenance header: source URL, DOI, sha256, licence, retrieval date |
| `scripts/fetch-ncei.mjs` | Maintainer-run refresh. Downloads, **verifies the hash**, converts to TSV. Never part of `data:build` |
| `scripts/lib/ncei.mjs` | Pure. TSV text → records. No network |
| `scripts/lib/ncei-match.mjs` | Pure. Atlas records + NCEI records → dispositions |
| `data/ncei-match-report.json` | Run output. Every row and what happened to it |

The mirror is committed because the upstream is decommissioned and because a
reviewer needs to read the input as text. `data:build` stays offline and
byte-reproducible, which it is today and which a network call would end.

`data/ncei-match-report.json` is a run output, not a fixture. It will not exist
until a run writes it, so any test reading it from the repository passes on
absence — the same trap already recorded for `coverage.json` and
`refutations.jsonl`. Tests must construct their own input.

## The match rule

Match when distance ≤ **200 m** *and* the names agree, or one side is unnamed.

"Agree" means: normalise both with the existing `normName()` from
`scripts/lib/geo.mjs`, then accept when either normalised name contains the
other. That is the rule the 70% figure below was measured with, so the number
and the rule cannot drift apart. Containment rather than equality is deliberate
— `Bijah Spring` and `Bijah Springs` are the same spring, and the substring
hazard that bit the dedupe pass (`No. 4` matching `No. 4b`) is bounded here by
the 200 m gate, which dedupe did not have.

Both halves are measured rather than asserted, which is the phase-1 lesson:
thresholds in a plan are assertions until someone measures them. 200 m is where
the cumulative curve is still steep and name agreement is still 70%.

**Ambiguity is a rejection, not a tie-break.** Where two NCEI rows contend for
one atlas spring, neither is applied and both go to the report. Under-importing
is the right error: attaching a group's temperature to a single vent would be
silently wrong, and silently wrong is the failure mode this project spends the
most effort avoiding.

## What a match writes

Only when the atlas has no temperature. If both exist and disagree, NCEI does
not overwrite and the conflict goes to the report.

- `temperature.celsius` — the °C column as printed
- `temperature.measuredAt` — `"1981"`
- `temperature.source` — the publication and DOI
- `temperature.qualitative` — for the 179 rows carrying `H`/`W`/`B` and no number
- `quality.provenance` — gains `"ncei"`

`measuredAt` needs **no schema change**. It is already an attribute a
temperature claim may carry (`overlay.mjs:449`) and is deliberately not
separately claimable, so provenance cannot drift from the value it describes.
An upstream stage writes record fields directly, as the OSM path does, so
`CLAIMABLE` is not involved at all and neither is the two-PR schema rule.

### Frontend

`DetailPanel` renders the temperature's `measuredAt` the way the minerals card
already does — *"Measured 1981 according to the source below."* The minerals
card's own comment states the principle: an undated figure rendered bare reads
as a measurement somebody took for you. A 45-year-old reading shown identically
to one verified against an operator's page yesterday would be exactly that.

## Tests

Written to fail first. The ones that would actually catch something:

- **Parse.** Fixtures including the three rows the first parser mis-sliced and
  each qualitative code. Self-closing cells and multi-cell names both get a
  case. The F↔C consistency check runs on every row and a failure is a
  rejection, not a warning.
- **Match.** Fixtures at 199 m and 201 m; name disagreement inside 200 m; two
  NCEI rows contending for one atlas spring.
- **Ordering.** Source-scan guards that the NCEI stage sits above the privacy
  filter and before the overlay, in the style of the existing
  privacy-filter-last test.
- **Precedence.** An overlay claim beats NCEI on the same field.
- **Hash.** `fetch-ncei.mjs` refuses a download whose sha256 does not match.

## Risks, stated plainly

**200 m is a judgement even though it is measured.** The report is what makes
it auditable rather than permanent.

**Yellowstone.** 98 NCEI rows sit in the park at a median 2.3 km from the
nearest atlas record, because the two datasets disagree about what a spring is:
NOAA lists named groups (`BLACK WARRIOR GROUP, SHELF SPRING`), OSM lists
individual vents. Expect most of Yellowstone to land unmatched and to be argued
about in stage two.

**Not every row belongs in this atlas.** The source includes fumaroles, steam
vents, mud pots and mud volcanoes. Enrichment is unaffected — a matched record
is already in the atlas on its own merits — but stage two cannot add rows
without deciding this, and the decision is a product one, not a filter to be
discovered later.

**1981 on a safety-relevant field.** Mitigated by showing the date, not by
hiding it.

## Expected outcome

Roughly 150 temperatures, US coverage moving from 12 to about 160, and a match
report that tells the maintainer what adding the other ~1,300 would actually
involve.

## Deferred to stage two

- Adding unmatched rows as new springs.
- Which feature types belong in an atlas of public hot springs.
- Yellowstone's group-versus-vent granularity.
