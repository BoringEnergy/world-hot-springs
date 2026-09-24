# How the atlas counts — features, sites, and what the number is

Drafted 2026-09-23. Status: **proposed, awaiting Hudson.** Not implemented.

The mission set on 2026-09-22 is an accurate count of the world's hot springs.
Two PRs removed what was wrong with the number (#100: 343 records that were not
springs; #101: 17 springs counted twice). This settles what the number *is*,
because "7,130 hot springs" currently answers a question nobody asked.

---

## The problem, measured

A record is whatever a mapper drew: a vent, a pool, a bathhouse, a whole spring.
Numbered pools at one site each count once ("Termita 1" to "Termita 4" in
Bolivia; Armenia's vents labelled "35°", "45°", "50°", "53°" six metres apart).

**1,242 of 7,130 records have another record within 25 m.** 2,483 have one
within 100 m.

Grouping records that lie within a linking distance *D* of each other
(single-linkage: a chain of neighbours is one group):

| D | 0 | 50 m | 100 m | 250 m | 500 m | 1 km | 2 km |
|---|---|---|---|---|---|---|---|
| groups | 7,130 | 5,715 | 5,229 | 4,735 | **4,462** | 4,256 | 3,993 |

The count falls steeply to about 250 m and then flattens. **There is no natural
break.** Whatever *D* is chosen, the site count is a convention, and it has to
be published as one.

## What an official count looks like

Japan's Ministry of the Environment counts two things, every year: **2,879
hot-spring localities (温泉地) and 27,932 sources (源泉)**, at the end of FY2022
(env.go.jp/nature/onsen/data). The atlas holds, for Japan:

| | atlas | official | share |
|---|---|---|---|
| features | 1,023 | 27,932 sources | 4% |
| sites at 500 m | 812 | 2,879 localities | 28% |

The two-unit split is how the one country with a national census already counts,
so the proposal below is not an invention. And the comparison says what the
atlas's number is: **a floor of what is publicly mapped, not a census.** Where
somebody official has counted, the atlas can say how complete it is.

---

## Decision 1 — Publish two counts, never one without the other

**Proposed.**

- **Features**: every record. What a mapper drew; the unit science and the map
  work in. Today 7,130.
- **Sites**: features grouped by Decision 2. What a visitor means by "a hot
  spring". Today about 4,460.

The headline becomes "7,130 mapped hot-spring features at about 4,460 sites",
never a bare number. `summary.json` gains `sites` beside `total`, overall and
per country.

## Decision 2 — A site is features linked within 500 m

**Proposed.** Single-linkage at **500 m**, position only.

- Below 250 m the count is still falling fast: pools and vents of one spring are
  still being split.
- Past 500 m chaining starts to join separate places along a valley. Iceland's
  largest group goes from 23 features at 500 m to 42 at 1 km; the US total
  drops by 67 more.
- Position only, not names: a name rule would re-open every question the dedupe
  work closed, and a site is a place, whatever its parts are called.

Yellowstone becomes a handful of very large sites (the largest holds 229
features). That is correct: a geyser basin is one place to visit. It is also
the case that makes the per-country site count a better comparison with other
countries than the feature count, where Yellowstone's 1,289 features dominate.

**Alternative worth considering:** 250 m (4,735 sites) is more conservative:
fewer features joined, less chaining. Japan's 温泉地 is a town-scale unit, well
above either; neither matches it exactly and neither should pretend to.

## Decision 3 — State completeness where an official count exists

**Proposed.** A short table in DATA.md, and eventually in the site's about
page: for each country with a published national inventory, the official count,
its unit, its year, and the atlas's features and sites against it. Japan first.
The others worth finding: Iceland (Orkustofnun), New Zealand (GNS), Taiwan,
Korea, Hungary, Turkey (MTA). Each is a claim with a source, reviewed like
any other, and a country with no inventory says so.

This is the sentence the project exists to be able to write: *the atlas holds at
least N hot springs; in Japan, where the government counts, it holds about a
quarter of them.*

---

## Out of scope here

- A per-record `siteId` and a site view on the map (grouping "Termita 1–4" on
  one card). The fun half of this and worth doing, but it is a schema addition
  and a UI change; it follows once the count's definition is agreed.
- Changing what counts as a feature (the scope in the NCEI stage-two spec, a
  place a person might enter, stands).

## Implementation, once accepted

`scripts/lib/sites.mjs`, pure: records in, groups out, deterministic by id
order. The build writes `sites` into `summary.json`. Tests pin the linking rule
on a chain, a pair just outside D, and a lone spring, plus a check that the
shipped summary recounts. README, DATA.md and CITATION description say both
numbers.
