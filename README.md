# World Hot Springs

An open, curated atlas of the world's public and semi-public hot springs.

There is no maintained, global, machine-readable tracker of hot springs. The
data that exists is scattered across national tourism boards, a 1965 USGS
survey, forum posts, and OpenStreetMap tags that nobody has ever normalised.
This repository is an attempt to fix that, in public, with the provenance
attached.

**6,471 springs across 129 countries** in the current build.

## What makes this different

**Unknown is a value.** Temperature, price, clothing policy and opening hours
are first-class fields. When we don't know one, the record stores `null` and the
UI renders **Unknown**. We never invent a plausible number, and we never leave a
field blank in a way that reads like an answer.

That honesty is the whole product, because the real numbers are humbling:

| Field | Known |
| --- | --- |
| Temperature | **1%** |
| Price | 14% |
| Hours | 7% |
| Clothing policy | 1% |

Barely one spring in a hundred, worldwide, has a recorded temperature. Most that
carry a `temperature` tag say `hot`, which is not a temperature — so we store
that separately and the card says *described as hot, no measurement recorded*.
Any hot spring site showing you a confident number for every entry is making
most of them up.

**We deliberately leave springs out.** See [PRIVACY.md](PRIVACY.md). Truly
hidden local springs are not on this map and there is no mode, login, or request
form that reveals them. This is the point of the project, not a limitation of
it.

**The dataset is ours and it is versioned.** Every record carries its sources,
its provenance, a completeness score, and the date it was last touched. You can
check us on any spring.

**We show our working, including the awkward parts.** The first build ranked
Iraq as the second most hot-spring-rich country on earth, because someone
bulk-imported a water-point dataset into OpenStreetMap under
`natural=hot_spring` years ago. The obvious automated fix flagged 1,957 of
Yellowstone's real springs as fake, so we didn't ship it. What we shipped
instead is a reviewed, public, arguable list in
[`data/known-bad-imports.json`](data/known-bad-imports.json), and the excluded
records are quarantined rather than deleted. The whole story is in
[docs/DATA.md](docs/DATA.md).

## Quick start

```bash
npm install
npm run data:all    # fetch from OpenStreetMap, then build the curated dataset
npm run dev
```

`data:all` is two stages and they are separable:

```bash
npm run data:fetch  # pull raw Overpass responses into data/raw/ (resumable)
npm run data:build  # normalise, dedupe, apply the privacy filter, write outputs
```

The fetch is tiled and resumable — every tile is cached to `data/raw/osm/`, so
an interrupted run costs nothing and re-running only fetches what is missing.

## Outputs

| File | What it is |
| --- | --- |
| `data/hot-springs.json` | Full `HotSpring` records. The source of truth. |
| `data/hot-springs.geojson` | The same records as a `FeatureCollection`, with license metadata. |
| `data/summary.json` | Counts, per-country totals, and field coverage. |
| `data/suspect.json` | Quarantined records with full provenance — kept out of the atlas, not deleted. |
| `public/data/` | Copies the web app fetches at runtime. |

## The data model

Defined in [`src/lib/types.ts`](src/lib/types.ts). Every field, the reasoning
behind each OSM tag mapping, and the deliberate deviations from the original
spec are documented in [docs/DATA.md](docs/DATA.md).

## Stack

Vite + React + TypeScript, MapLibre GL (globe projection — no API key, no
token), Tailwind, Zustand. The basemap is CARTO's keyless dark style. The whole
app is static and deploys anywhere.

## Sources and license

Current build derives from OpenStreetMap: `natural=hot_spring` plus
`amenity=public_bath` with a thermal `bath:type`. Map data © OpenStreetMap
contributors, licensed **ODbL 1.0** — which the derived dataset inherits.
Basemap © CARTO.

Code is **MIT**. The dataset is **ODbL 1.0** with attribution, matching its
upstream.

## Contributing

Corrections and new public springs are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md). Submissions that would expose a spring the
local community wants left alone are rejected, respectfully and permanently.

## Safety

Geothermal water scalds. Undeveloped sources have no staff and no rescue, and
temperatures shift with rainfall and season. Every reading here is a starting
point, not a guarantee. Test the water before you get in.
