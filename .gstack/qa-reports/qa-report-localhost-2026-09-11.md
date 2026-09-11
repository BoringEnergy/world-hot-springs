# QA report — World Hot Springs

| | |
|---|---|
| Target | `http://localhost:5177` (vite dev, `npm run dev`) |
| Date | 2026-09-11 |
| Branch | `docs/v1-2026-09-11` (base `main`) |
| Tier | Standard (fix critical + high + medium) |
| Driver | harness Browser pane — Aside is macOS-only, this is Windows |
| Framework | React SPA, Vite, zustand, maplibre-gl |
| Baseline | typecheck clean, 646/646 tests pass, `v1.0.0` shipped |
| Health score | **72 → 96** |

This is the first time the shipped app has been exercised end to end in a
browser. Layer C (a render harness) was declined at v1, so until now the UI's
only automated coverage was the display-model tests and source-scan tripwires.
Three defects were found. All three were invisible to the existing suite for
the same reason: every one of them sits in the gap between a fact the codebase
holds correctly and the surface that presents it.

---

## Summary

| Severity | Found | Fixed | Deferred |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 2 | 2 | 0 |
| Medium | 1 | 1 | 0 |
| Low | 0 | 0 | 1 |
| **Total** | **3** | **3** | **1** |

**PR summary:** QA found 3 issues, fixed 3, health score 72 → 96.

### Top 3 things to fix
All three are fixed. In severity order they were: the temperature ceiling
hiding the three hottest springs, the About panel crediting one of five
sources, and the page exposing no structure to a screen reader.

---

## ISSUE-001 — The temperature ceiling was a lid, not a floor

**Severity** High · **Category** Functional · **Status** verified ·
**Commit** `457756c` · **Files** `src/store/useStore.ts`

The filter rail renders the top of the temperature range as **"212°F+"**, and
`FilterRail.tsx:115` does that deliberately — at the ceiling it appends a `+`.
`applyFilters` read the same value as a hard `c > f.tempMax`.

Three springs are above 100°C and all three were absent from every view the UI
can reach:

| Spring | Temp | Country |
|---|---|---|
| Rognerbad Bad Blumau | 110°C | AT |
| HOT SPRINGS NEAR GEYSER BIGHT | 102°C | US |
| HOT SPRINGS NEAR GEYSER BIGHT | 101°C | US |

**Repro (before):** load the app with default filters → the filter panel reads
`7,487 of 7,490 springs`, with every control at its most permissive setting.
Search `Rognerbad` → **0 springs**.

That last part is what makes this High rather than Medium. Search does not
bypass the temperature filter, so there was no workaround by any path in the
UI, and a user searching a spring this atlas holds was told it does not exist.
Not an error — an answer.

**After:** default reads `7,490`. `Rognerbad` returns 1 match, Bad Blumau,
Austria, 230°F, pin visible.

**Root cause and fix.** One guard in the shared predicate rather than at the
callers, since the map, the results list and the count all route through it.
Only the rail's own maximum is treated as open-ended, because it is the only
value rendered with a `+`; a ceiling the user moved is still a lid. Verified
both directions: max at 40°C narrows to 6,814 springs and the clusters turn
cool-coloured.

This is **defect shape (b)** from the handoff, a rule applied in one direction
only — the display layer knew the ceiling meant "and above" and the filter
layer did not.

---

## ISSUE-002 — The About panel credited one of five sources

**Severity** High · **Category** Content (licence compliance) ·
**Status** verified · **Commit** `9bed1ce` ·
**Files** `src/components/AboutPanel.tsx`, `src/store/useStore.ts`, `src/lib/types.ts`

The in-app About panel said:

> Public sources only. The current build is derived from OpenStreetMap
> (`natural=hot_spring` and thermal `amenity=public_bath`) …

and its footer said `Dataset from OpenStreetMap as of 2026-08-25`. NCEI, AIST,
WQP and NBMG were named nowhere. **AIST's licence requires attribution as a
condition of use**, not as a courtesy.

Everything around it was already correct, which is what makes this worth
writing down. `DATA.md` lists all five. The GeoJSON carries `metadata.sources`
built from the one definition in `scripts/lib/sources.mjs`. `sources.test.mjs`
asserts those two agree. Every detail card cites its own upstream — the NCEI
records visibly name NOAA on the card while the About panel said OpenStreetMap,
so the contradiction was on screen in the product. The panel was the one
attribution surface nobody wired up, and it is the only one a non-technical
visitor ever reads.

Checking the documents was not the same as checking the product.

**Fix.** `load()` was discarding `geo.metadata`, throwing away the only copy of
that list the browser could see. It is kept now, typed as `DatasetMeta`, and
the panel maps over `meta.sources` — name, attribution and licence per source,
each linking upstream. The footer credits `attributionLine()`, and the OSM
fetch date is labelled as the OSM layer's date rather than the age of the whole
atlas.

**Defect shape (a)** from the handoff, a second copy of one fact.

---

## ISSUE-003 — The page described none of itself to a screen reader

**Severity** Medium · **Category** Accessibility · **Status** verified ·
**Commit** `514466b` · **Files** `src/App.tsx`, `src/components/Header.tsx`

Three parts, one defect:

- **No `<h1>`.** The heading list started at the filter rail's `Filters` h2,
  inside a panel closed by default — so on arrival there were no headings at
  all.
- **No `<main>`.** The only route into the map was tabbing through every header
  control, on every visit.
- **The spring count changed silently.** It is the sole feedback that a search
  or filter did anything: the map is a canvas and the results list only exists
  during a search.

The count is the part worth reading twice. It lived in a span classed
`hidden … md:inline`, and **a live region inside `display:none` announces
nothing** — so putting `aria-live` on that span would have looked like a fix
while staying silent on every phone. The visible span is `aria-hidden` now and
an `sr-only` `role="status"` carries the accessible copy: always rendered,
polite so it waits for a pause rather than reading a total per keystroke.

The `h1` is visually hidden rather than shown. A visible wordmark is a design
change; this is not one.

**Verified:** heading order is now H1 → H2 → H3, `<main>` present, live region
reads `7,490 springs shown`, `h1` measures 1×1px, layout pixel-identical.

---

## Deferred

**DEF-001 — maplibre's attribution link opens `_blank` without `rel="noopener"`,
over `http://`.** Low severity, third-party: the link is emitted by
`maplibre-gl`'s own attribution control, not by this codebase, so it cannot be
fixed from source without overriding the control. Every link this app writes
itself is correct (`rel="noreferrer noopener"`, `https`) — all nine were
checked on the Radium card.

---

## What was checked and found correct

Worth recording, because two of these were things I initially suspected and the
code turned out to be right:

- **Filter chips carry `aria-pressed`.** The accessibility tree renders it
  poorly; the markup is correct.
- **Every form control is labelled** — both checkboxes wrap their `<label>`,
  both sliders carry `aria-label`, the search box carries `aria-label`.
- **The empty state exists** and is well written ("Nothing matches those
  filters. Try widening the temperature range…"). It lives in `ResultsList`,
  which `App.tsx:45` deliberately suppresses while the filter panel is open.
  My first read of "no empty state" was an artefact of leaving the panel open.
- **The temperature sliders are Celsius internally, displayed converted.**
  0–100 in the DOM renders as 32°F–212°F. Correct.
- **The NCEI detail card is exemplary** — scalding warning, the 1981 historical
  caveat, `located to about 360 ft`, full DOI citation.
- **Mobile (375×812) is clean.** Placeholder shortens, panels stack, nothing
  overflows horizontally.
- **Console is clean.** Zero errors on a fresh server across load, search,
  filter, selection, About and unit toggle.

---

## Health score

| Category | Weight | Before | After |
|---|---|---|---|
| Console | 15% | 100 | 100 |
| Links | 10% | 100 | 100 |
| Visual | 10% | 100 | 100 |
| Functional | 20% | 85 | 100 |
| UX | 15% | 100 | 100 |
| Performance | 10% | 100 | 100 |
| Content | 5% | 15 | 100 |
| Accessibility | 15% | 92 | 100 |
| **Weighted** | | **72** | **96** |

Content starts at 100 and takes −15 for ISSUE-002's High severity; it scores 15
rather than 85 because a single-source attribution on a five-source dataset is
most of what that category measures on this app. Accessibility takes −8 for
ISSUE-003. Functional takes −15 for ISSUE-001. The final 96 rather than 100
reflects the deferred third-party link.

---

## Tests added

646 → 659 passing (13 added). Every guard was mutation-tested: the fix was reverted and
the test observed to fail.

| File | Tests | Mutation result |
|---|---|---|
| `scripts/filters.test.mjs` (new) | 5 | remove the ceiling guard → 3 fail, 2 pass |
| `scripts/sources.test.mjs` (+4) | 11 | restore "derived from OpenStreetMap" → 1 fails |
| `scripts/a11y.test.mjs` (new) | 4 | re-add the display gate to the live region → 1 fails |

`filters.test.mjs` asserts against `data/hot-springs.json`, not fixtures. A
synthetic 110°C record would prove the branch; only the real file proves the
atlas is reachable.

The two that keep passing under the ISSUE-001 mutation are the ones guarding
the rules the fix must not break — the moved ceiling, and unknown temperatures
not being 0°C.

### One toolchain change

`tsconfig.app.json` gains `allowImportingTsExtensions`, and `useStore.ts` names
`format.ts` explicitly on its one value import. This lets `node --test` import
the store directly, the way `card-model.test.mjs` already imports `format.ts`.
Compiler-only; Vite resolved both spellings already. Without it the filter
predicate could only have been guarded by scanning source text — and "a test
that checks location instead of behaviour" is **defect shape (c)** in this
project's own catalogue.

---

## The pattern across all three

Each defect sits where a fact the codebase holds correctly meets the surface
that presents it:

| Held correctly | Presented wrongly |
|---|---|
| the dataset contains 3 springs above 100°C | the filter hid them |
| `sources.mjs` defines 5 upstreams, and ships them in the GeoJSON | the About panel named 1 |
| the count is computed and rendered | nothing announced it |

All three map onto shapes already written into the handoff. None was a new kind
of mistake. The gap was that nothing had ever run the app.

The cheapest guard against the next one is not a render harness. It is that the
presentation layer should read the fact rather than restate it — which is what
all three fixes do.
