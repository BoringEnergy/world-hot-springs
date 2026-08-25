# The dataset: sources, mappings, and every judgement call

This documents how a raw OpenStreetMap element becomes a `HotSpring` record, and
why each decision was made. If you disagree with a mapping, this is the file to
argue with.

## Pipeline

```
Overpass API  ->  data/raw/osm/tile-*.json   (scripts/fetch-osm.mjs)
              ->  normalise                  (scripts/lib/normalize.mjs)
              ->  country resolve            (scripts/lib/countries.mjs)
              ->  bad-import quarantine      (data/known-bad-imports.json)
              ->  dedupe                     (scripts/lib/identity.mjs)
              ->  durable identity           (scripts/lib/identity.mjs)
              ->  curated overlay            (scripts/lib/overlay.mjs)
              ->  privacy filter             (scripts/lib/exclusions.mjs)   <- always last
              ->  data/hot-springs.{json,geojson}, data/summary.json
                  data/registry.json, data/events.jsonl
```

The privacy filter is last, and a test asserts it. Nothing that can add, move,
or reintroduce a record may run below it. `mergeInto()` adopts the winner's
coordinates, so a merge relocates a record by up to 300 m -- running dedupe
after the filter would let a record clear the exclusion check at its own
position and then be pulled inside an exclusion radius.

Every stage prints what it dropped and why. A pipeline that silently discards
records is a pipeline you cannot trust, so `data:build` is deliberately noisy.

## Stage 1 — fetch

The world is tiled into 30° × 30° cells and each is queried separately. A single
global Overpass query for `natural=hot_spring` reliably times out. Tiling keeps
each request small enough to succeed and makes the run resumable: each tile's
response is cached, and re-running skips what's already on disk.

Tiles are ordered by expected density (30–60°N first), so an interrupted run
already holds the interesting half of the world rather than 30 tiles of Southern
Ocean.

Overpass mirrors are rotated on failure with exponential backoff. The client
aborts at 90s even though the server budget is 180s — a mirror that accepts the
connection then stalls should cost 90 seconds, not four minutes.

### Stage 1b — verify (`npm run data:verify`)

**A tile file existing is not evidence that it is correct.**

The first full run of this pipeline produced 4,553 springs and looked fine.
Tile `30_-120` — which contains Yellowstone, Idaho, Colorado and half of Nevada
— reported **zero** elements. A mirror had answered HTTP 200 with an empty
element list, which is indistinguishable from "there are no hot springs here"
unless you go and check.

So we check. `--verify` runs a cheap server-side `out count;` for every tile and
compares it against the cached file, refetching anything short and exiting
non-zero if a tile still doesn't reconcile. The first verify pass recovered
2,565 elements from that one tile and 981 from western Europe.

The mirror responsible (`maps.mail.ru`) was removed from the rotation. Any
mirror added in future has to survive a verify pass before it is trusted.

The lesson generalises: for a bulk ingest, "the request succeeded" and "the
data arrived" are different claims, and only one of them is worth putting in a
dataset.

### What we query

| Tag | Why |
| --- | --- |
| `natural=hot_spring` | The canonical tag. Nodes, ways, and relations. |
| `amenity=public_bath` + `bath:type~onsen\|thermal\|hot_spring` | Developed onsen and thermae that mappers file under the *bath* rather than the *source*. This is most of Japan and much of central Europe. |

Those two together are the difference between a partial dataset and a real one.

## Stage 2 — normalisation

### Rejections

| Reason | Rationale |
| --- | --- |
| `access=private` / `access=no` | Somebody's property, not a destination. The atlas is public and semi-public springs. |
| `natural=geyser` without a bath tag | Hot water, wrong use. Not a place you get into. |
| No geometry | Nothing to map. |

### `name`

`name` → `name:en` → `name:en-Latn` → `null`.

**Deliberate deviation from SPEC.md:** `name` is `string | null`, not `string`.
A large share of real, publicly-mapped springs have no name in any source.
Synthesising one ("Hot spring near Reykjadalur") would be inventing data, which
the project's core rule forbids. The UI renders `null` as *Unnamed spring*.

### `temperature`

Parsed from the OSM `temperature` tag, which is free-form in practice. Real
values in the wild: `45`, `45 C`, `45°C`, `40-45`, `113 F`, `~42`, `hot`.

- Ranges collapse to their **midpoint**, with the original range preserved in
  `temperature.source` so nothing is lost.
- Fahrenheit is detected and converted; `celsius` is canonical and `fahrenheit`
  is stored alongside it.
- Qualitative values (`hot`, `warm`, `scalding`) yield `celsius: null`, because
  "hot" is not a temperature — but they are **not discarded**. They are stored
  in `temperature.qualitative`, so a record can say *described as hot, no
  measurement recorded* rather than a bare Unknown.

  This is the difference between "nobody has looked" and "somebody looked and
  didn't bring a thermometer", and in this dataset the qualitative case is the
  **common** one: of ~130 springs carrying a `temperature` tag, roughly 100 say
  `hot`. Barely 1% of springs worldwide have a numeric reading. That is the
  single most important fact about the state of hot spring data, and it is why
  the temperature filter defaults to including unmeasured springs.
- Anything outside **−5 °C to 130 °C** is treated as a mis-tag (units confusion
  or a sentinel value), not a reading. Liquid water at surface pressure caps out
  near 100 °C.

### `access.price`

OSM splits this across `fee` (yes/no) and `charge` (an amount).

| Input | Result |
| --- | --- |
| `charge=500 JPY` | `price: "500 JPY"`, `currency: "JPY"` |
| `fee=no` | `price: "Free"` |
| `fee=yes`, no charge | `price: "Paid (amount unknown)"` |
| donation payment | `price: "Donation"` |
| neither | `null` → **Unknown** |

We keep the human-facing string rather than normalising every currency to USD.
Converting 500 JPY to a USD figure that will be wrong next quarter is worse than
showing the price the operator actually charges.

### `clothing.policy`

OSM's `nudism` key is the only widely-used signal, and its semantics are the
reverse of what you'd guess:

| OSM | Our policy | Means |
| --- | --- | --- |
| `nudism=obligatory` | `required` | Nudity required |
| `nudism=customary` / `yes` / `permissive` | `optional` | Clothing optional |
| `nudism=no` | `textile-only` | Swimwear required |
| `clothing_optional=yes` / `no` | `optional` / `textile-only` | Less common synonym |
| `bath:sex=separated` | `mixed` | Gender-separated bathing, noted in `schedule` |
| absent | `unknown` | |

`nudism=permissive` additionally records "Tolerated rather than formally
permitted", which is a materially different thing to show a visitor.

### `hours`

The raw OSM `opening_hours` string is kept verbatim — it is a real
[spec](https://wiki.openstreetmap.org/wiki/Key:opening_hours), not prose — and a
coarse `status` is derived from it. `disused:*` tags map to `closed`. A string
containing month names maps to `seasonal`.

### `type`

The distinction users actually care about is *did someone build something here*.

- `resort` — a bath tag **and** hotel/resort/ryokan/spa signals.
- `developed` — a bath tag, or a natural spring with an operator, a fee, a
  building, or a pool.
- `wild` — `natural=hot_spring` with no name, no operator, no website.
- `natural` — everything else with `natural=hot_spring`.

### `warnings`

Generated from facts already in the record, never editorialised:

- ≥ 50 °C → scalding warning. Water at that temperature burns in seconds, and
  saying so next to the number is the honest thing to do.
- 44–50 °C → above comfortable soaking temperature.
- `wild` → no staff, no facilities, no maintained access.
- `access=permissive` → the landowner can withdraw it at any time.
- mapped `hazard`, geyser, `drinking_water=no` → passed through.

### `quality.completeness`

Percentage of six first-class fields that carry a real value: name, temperature,
price, clothing, hours, type. This is what the bar in the detail card shows. It
measures *how much we know*, not *how good the spring is*.

## Stage 3 — country resolution

OSM almost never tags `addr:country` on a spring, so country comes from
geometry: point-in-polygon against Natural Earth admin-0 (50m), cached locally
after first download.

Coastal and small-island points can land just outside every polygon at 50m
resolution. Rather than dropping them to Unknown, we fall back to the nearest
polygon within 0.5° and set `quality.countryInferred`. A spring 400 m off the
digitised coastline of Iceland is in Iceland, and saying so is not inventing
data.

## Stage 3b — bad upstream imports

The first credible-looking build ranked **Iraq as the second most hot-spring-rich
country on earth**, ahead of Japan and Iceland, with 984 records. Syria had 424,
Libya 234, Yemen 158.

They are not hot springs. Central Baghdad held 263 nodes tagged
`natural=hot_spring` named after city districts, checkpoints and villages —
*Zajalba village*, *Muhsin checkpoint*, *new paved entrance*. The Libyan ones
are irrigation boreholes on the Great Man-Made River centre-pivot fields, named
with well identifiers (`6J659`, `-193c`). Someone bulk-imported water-point
datasets under the wrong tag, years ago, and nobody fixed it.

### Why there is a list instead of a rule

The obvious automated rule is "a dense cluster of attribute-free nodes is a bulk
import". It was implemented and measured before being trusted. It flagged
**1,957 of Yellowstone's 1,959** attribute-free springs, plus most of Rotorua.
Those are real. A geyser basin and a bulk import have the same statistical
shape, and no threshold separates them.

So the decision is a judgement call, and it is written down as one, in
[`data/known-bad-imports.json`](../data/known-bad-imports.json): four named
imports, each with the evidence, the date it was reviewed, and instructions for
disputing it. Matched records are **quarantined to `data/suspect.json`**, never
deleted, so reinstating one is a one-line edit rather than a re-ingest.

That file is public, unlike the privacy exclusion list. The distinction is
deliberate: hiding a spring is a promise we made to someone, but calling
somebody's data wrong is a claim, and a claim should be arguable.

### What survives

The rule only matches records carrying *nothing* but `natural` and a name. A
properly attributed Iraqi spring is untouched — Hammam al-Alil, the real thermal
bath south of Mosul, has attributes and stays. Iraq drops from 984 to 33, and
those 33 are still worth reviewing by hand.

### Also quarantined

A narrower, name-based check catches identifier-named nodes elsewhere
(`c-175`, `0061`) that carry no other attribute — 153 records, mostly Libya and
Egypt.

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

Ids are 12 hex characters of a SHA-256 of the first OSM ref. Six was tried first
and measured: it produced **two real collisions** across the dataset's 7,638 OSM
refs, an ~82% birthday probability. Two springs sharing a durable id means
claims attaching to the wrong spring, silently and permanently. The mint site
also asserts the id is unused and throws naming both refs, so a future collision
is loud rather than silent.

**Overlay.** `data/overlay/<id>.json` holds field-level claims. Claims override
derived values; unclaimed fields keep tracking OSM. Array fields merge and never
remove, so a claim cannot strip a derived scalding warning. `temperature.source`
and `temperature.measuredAt` are derived from the temperature claim's own
metadata rather than being separately claimable, so provenance cannot drift from
the value it describes.

When an active claim disagrees with upstream, the curated value keeps rendering
and a `claim.contested` event is appended to `data/events.jsonl`. Temperature
allows 0.5 °C of tolerance; everything else is exact.

An overlay file naming a spring absent from the build is a **fatal error**. A
claim with nowhere to land is a correction about to vanish silently. A claim
whose spring the privacy filter removes is reported by id only — never with the
claim contents or the matched rule, since a detailed message is an oracle for
locating exactly what the exclusion list protects.

### Reproducibility

The build is byte-for-byte reproducible from committed inputs. Timestamps come
from the newest raw tile mtime, or `SOURCE_DATE_EPOCH` when set — never the
clock. Before this, every rebuild rewrote `lastVerified` on all 6,471 records
and buried any real change in a ~6 MB diff. Since a later phase accepts curated
corrections as pull requests, an unreviewable diff is a review-integrity
problem, not just an annoyance.

## Stage 4 — privacy filter

Runs **last**, after normalisation and before anything is written. See
[PRIVACY.md](../PRIVACY.md). The build refuses to emit output if any record
carries `unicorn !== false`.

## Stage 5 — dedupe

The common case is one spring mapped as both a node (the source) and a way (the
pool around it). Records within **60 m** whose names don't contradict each other
are merged: the more complete record wins, and the loser's sources, warnings and
tags are folded in so no provenance is lost.

Comparison uses a ~1 km spatial hash, so each record is checked against a handful
of neighbours rather than the whole dataset.

## Known limitations

- **Coverage follows OSM's coverage**, which is excellent in Japan, Iceland, and
  central Europe and thin in parts of central Asia, the Andes, and east Africa.
  The gap is real and the summary counts make it visible rather than hiding it.
- **Nothing is human-verified yet.** Every record from a bulk ingest carries
  `verified: false`. That flag flips only when a person checks the record
  against a primary source.
- **No temperature provenance beyond OSM.** `measuredAt` is `null` on every
  record because OSM does not carry measurement dates. A spring's tagged
  temperature may be decades old.
- **Prices go stale.** They are quoted as the operator stated them, whenever
  that was.

## Sources not yet ingested

Planned, in rough order of value: the digitised Waring 1965 USGS thermal springs
list (US, public domain), national tourism board open data (Japan, Iceland, New
Zealand, Hungary), and peer-reviewed geothermal surveys. Each needs its own
normaliser and its own entry in this document.
