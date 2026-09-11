# Where this data comes from

Five upstreams, three kinds of licence. This page exists because one of them
**requires** attribution rather than merely inviting it, and because the
README said "derives from OpenStreetMap" for a month after that stopped being
the whole truth.

The machine-readable version of everything below travels with the data, in
`data/hot-springs.geojson` under `metadata.sources`. Both are generated from
one definition in `scripts/lib/sources.mjs`, and a test asserts this page and
that file agree — an attribution that drifts from what actually shipped is
the worst kind of stale document.

## The collection

**ODbL 1.0** — <https://opendatacommons.org/licenses/odbl/1-0/>

ODbL because ODbL is share-alike and OpenStreetMap is in here. Mixing a
share-alike database with public-domain and CC BY sources does not dilute the
share-alike obligation, so the derived database inherits the strictest term
rather than the most convenient one.

Code is MIT. The dataset is ODbL. They are not the same licence and the
distinction matters if you reuse one without the other.

## The sources

### OpenStreetMap — `osm`

Base layer, and it placed the great majority of the pins. 6,467 records carry
it.

- **Licence** ODbL 1.0
- **Attribution** © OpenStreetMap contributors
- <https://www.openstreetmap.org/>

Queried as `natural=hot_spring` plus `amenity=public_bath` carrying a thermal
`bath:type`. Re-fetch with `npm run data:fetch`.

### NOAA NCEI, Thermal Springs List for the United States (1981) — `ncei`

Minted 1,023 US pins and corroborated 131 more. doi:10.25921/c8p0-zs06

- **Licence** CC0 1.0 Public Domain Dedication
- **Attribution** NOAA National Centers for Environmental Information
- <https://doi.org/10.25921/c8p0-zs06>

A pin from this source carries a standing warning that the reading and the
spring's existence are historical: nobody has checked the ground since 1981.
Mirrored to `data/reference/ncei-thermal-springs.tsv`, pinned by sha256.
Re-fetch with `npm run data:ncei`.

### AIST/GSJ, Geochemical Map of Hot Spring Waters (GRES-DB ONSEN 2020) — `aist`

Japanese wellhead temperatures, chemistry panels and Hot Spring Law
classifications. 70 records.

- **Licence** 政府標準利用規約 第2.0版, stated as CC BY 4.0 compatible.
  **Attribution required.**
- **Attribution** Geological Survey of Japan, AIST
- <https://gbank.gsj.jp/gres-db/>

**This is the licence that obliges this page.** The other four invite credit;
this one conditions the use on it.

Every position AIST publishes is a cell 187–191 m across — a publisher
privacy choice, not GPS scatter. This atlas uses those centroids as a match
key only. **No pin is ever placed at one**, and `location.accuracyMeters` is
never stamped with 190 on a record OSM already placed precisely. Mirrored to
`data/reference/aist-onsen.tsv`, pinned by sha256.

### Water Quality Portal (USGS / EPA / NWQMC) — `wqp`

US spring temperatures. 40 records.

- **Licence** US federal government work, public domain
- **Attribution** US Geological Survey, US Environmental Protection Agency and the National Water Quality Monitoring Council
- <https://www.waterqualitydata.us/>

**A snapshot, not a pinned derivation.** The upstream is a query with no
published archive, so re-running the fetcher returns more rows. The mirror
carries its own sha256 and the date it was taken; `data:build` is
reproducible from it, the fetch is not. `data/reference/wqp-spring-temps.tsv`,
`npm run data:wqp` — roughly ninety minutes, out of band.

### Nevada Bureau of Mines and Geology, AASG state geothermal data — `nbmg`

Nevada and Colorado spring chemistry. 109 records.

- **Licence** US state geological survey data, public domain
- **Attribution** Nevada Bureau of Mines and Geology, University of Nevada, Reno
- <https://web2.nbmg.unr.edu/ArcGIS/rest/services/>

Chemistry only. The same service publishes water temperatures and they are
deliberately not read — measured at twelve springs against this atlas, which
is not worth a fetcher. Also a snapshot rather than a pinned derivation, for
the same reason WQP is. `data/reference/nbmg-spring-chemistry.tsv`,
`npm run data:nbmg`.

## What is not a source

Curated claims in `data/overlay/` are authored corrections, each citing a
page that `scripts/verify-claims.mjs` re-fetches and checks. They are not an
upstream and carry no licence of their own; the cited source is named on the
record and on the card.

## Not published, ever

Springs the local community wants left alone. The exclusion list lives
outside this repository and the privacy filter is the last stage of the
build, asserted by a test. See [PRIVACY.md](PRIVACY.md).
