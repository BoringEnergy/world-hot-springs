# Korea and Iceland — can the atlas fill its two thinnest countries?

Findings 2026-09-23. **Decided 2026-09-24:** I1 (Iceland worklist) built in
#107. Hudson chose K1 for Korea, and **K1 was measured before building and does
not work**; see "K1, measured" below. Korea's coverage stays as it is.

The official-count comparison (DATA.md, "How the atlas counts") showed the atlas
thinnest in South Korea (33 sites beside 446 official hot-spring areas, 0.07) and
Iceland (167 sites beside 1,388 geothermal cells, 0.12). This asks whether an open
source could close either gap. Research ran in parallel; every licence and count
below was then re-read from the primary page.

---

## South Korea — viable, but the in-scope list has addresses, not coordinates

| Dataset (data.go.kr) | Rows | Coordinates | What a row is | In scope? |
|---|---|---|---|---|
| 행정안전부_전국 온천이용업소 현황 ([15086533](https://www.data.go.kr/data/15086533/fileData.do)), modified 2026-09-08 | **524** | **no**: name, phone, address | a hot-spring bathhouse or hotel (Korea Hot Spring Association members) | **yes** |
| 전국온천표준데이터 ([15155686](https://www.data.go.kr/data/15155686/standard.do)), modified 2026-09-15 | 65 | yes (위도, 경도) | a legally designated hot-spring area; only 10 local governments report | as a site |
| Busan city ([15066572](https://www.data.go.kr/data/15066572/fileData.do)) | 48 | yes | Busan facilities | yes |
| LOCALDATA 목욕장업 permits ([15045082](https://www.data.go.kr/data/15045082/fileData.do)) | 17,470 | yes | every public bath; **no hot-spring flag** | no |

Licence on each: **"이용허락범위 제한 없음"** ("no restriction on the scope of
use"). No 공공누리 (KOGL) type is attached. The portal's own type 1 permits
commercial use and derivatives with attribution, and "no restriction" is at
least that open, so the data is compatible with ODbL provided we attribute it.

**The finding that matters most:** the 38 Korean records the atlas holds today
are mostly bathhouses mapped in OSM. Some are doubtful: "궁전목욕탕 (폐쇄)" is a
bathhouse marked closed, and several 사우나/목욕탕 are ordinary public baths. A
Korean public bath does not have to use hot-spring water. The 524-row list is
the licensed hot-spring set, so it can **check** the existing records as well
as add new ones.

### Decision K — how to place 524 addresses on the map

- **K1 (recommended): geocode with OpenStreetMap's Nominatim.** Coordinates
  derived from OSM are ODbL already, so the licence stays clean. At 1 request a
  second, 524 addresses take under ten minutes, and the results are committed
  and pinned by hash like every other mirror, never fetched live. Each pin
  states `accuracyMeters` at address level, and a geocode that fails or lands
  outside its stated 시군구 (district) is left out and listed, not guessed.
  Existing Korean records that match nothing on the list are flagged for
  review, not deleted.
- **K2: geocode with the Korean government's Juso or V-World API.** Likely more
  accurate on Korean road addresses, but it needs an API key, and whether its
  output may be reused under ODbL is not stated. That would have to be settled
  first.
- **K3: import only the 113 rows that already have coordinates** (the standard
  data plus Busan). No geocoding, but it misses the 524 bathhouses that are the
  in-scope set.

### K1, measured (2026-09-24) — not viable

A deterministic sample of 30 of the 524 rows (every 17th), sent to Nominatim
one request a second:

| Query | Building or point of interest | Road only | Nothing |
|---|---|---|---|
| the row's address | **5** | 12 | 13 |
| the business name and its district | **6**, one of them wrong ("세종" matched a hospital) | 0 | 24 |

A road-level result is the road's centroid, and roads such as 죽령로 run for
tens of kilometres, so it is not a pin. OpenStreetMap holds too few Korean
house-number addresses, and the businesses themselves are rarely mapped under
the names the list gives them. **About one row in six could be placed, so K1
would publish a sixth of Korea's licensed set and imply that was all of it.**

The sample also showed the list is looser than "hot-spring bathhouses". Rows
include motels, unmanned love hotels, a PC-room hotel, a housing company and a
residents' council: anything licensed to *use* hot-spring water.

It cannot check the existing records either. 7 of the atlas's 38 Korean names
match a listed business, and 2 of those 7 are coincidences. Well-known springs
such as 수안보, 청도용암온천 and 능암온천랜드 are absent, because the list is Korea
Hot Spring Association members (524 of the ministry's 555 licensed businesses).
Absence from it proves nothing.

**What would work, if Korea matters enough:** K2, the government's Juso
address API, which does hold Korean road addresses. First, its terms must be
confirmed to allow republishing its coordinates under ODbL, and a key obtained.
Even then, the list's scope (motels and companies) would need filtering to
places people go to bathe.

## Iceland — no open list of places to bathe

- **Orkustofnun's 2024 geothermal map is not open.** It can only be viewed at
  map.is/os, the service behind it refuses direct requests, and no licence is
  stated ("© Orkustofnun 2025"). The appendix table (OS-2024-19) has names but
  no coordinates, and its type column cannot tell a bathing pool from a warm seep.
- **Náttúrufræðistofnun publishes open data under CC BY 4.0**
  ([natt.is](https://www.natt.is/is/midlun/opin-gogn): "Opin gögn
  Náttúrufræðistofnunar eru gefin út samkvæmt Creative Commons afnotaleyfi, CC
  BY 4.0"). Its geothermal point layer (1,037 points, 2003) classes each point
  by temperature: 321 *laug* (25–70 C), 371 warm seeps, 193 steam, 97 *hver*
  (above 70 C), 47 carbonated. It has **no names**, and nothing in it says
  whether anyone can bathe there. The IS 50V place-name layer adds 119 named
  "laug" points, and a name is not evidence that a pool exists today.

### Decision I — what to do with Iceland

- **I1 (recommended): a worklist, not an import.** Match the 321 *laug*
  points and the 119 named ones against the atlas's 167 Icelandic sites, and
  write the ones the atlas lacks to a report. Each becomes a record only when a
  separate source shows people bathe there. That is the Turkey method already
  in the handoff, and CC BY 4.0 permits it with attribution. An import would
  put a 2003 temperature class on the map as a bathing place, which is the
  NCEI stage-two mistake the atlas already decided against.
- **I2: ask Umhverfis- og orkustofnun for a licence** to the 2024 map. It is the
  better dataset (2,274 clusters), but it is not published for reuse. This is a
  letter from Hudson R&D, not code.
- I1 and I2 can both be done.

---

## Why these are decisions

Both are new upstreams, and the v1 handoff says a new bulk upstream needs a
decision even under the count mission. K also brings in a geocoder, the first
time a coordinate in the atlas would come from an address instead of from
somebody placing a pin. That changes what a pin claims, which is why
`accuracyMeters` exists and why it would be stated on every one.
