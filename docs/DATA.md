# The dataset: sources, mappings, and every judgement call

This documents how a raw OpenStreetMap element becomes a `HotSpring` record, and
why each decision was made. If you disagree with a mapping, this is the file to
argue with.

## Pipeline

```
Overpass API  ->  data/raw/osm/tile-*.json   (scripts/fetch-osm.mjs)
              ->  normalise                  (scripts/lib/normalize.mjs)
              ->  country resolve            (scripts/lib/countries.mjs)
              ->  privacy filter             (scripts/lib/exclusions.mjs)
              ->  dedupe
              ->  data/hot-springs.{json,geojson}, data/summary.json
```

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
