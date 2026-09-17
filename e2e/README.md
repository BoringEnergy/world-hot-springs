# The browser harness

Playwright, headless Chromium, the production build, and no network.

```bash
npm run test:e2e:install     # once per machine: Chromium's headless shell
npm run test:e2e             # builds dist-e2e/, serves it on 127.0.0.1:4173, runs e2e/
npm run typecheck:e2e        # the specs and playwright.config.ts
npx playwright show-report   # after a run, locally (never a fork PR's report)
```

`npm test` does not run these, and `npm run build` does not type-check them.
Both are deliberate: the Node suite stays a few seconds long, and a type error
in a spec cannot stop the site deploying (`tsconfig.e2e.json` is not
referenced from `tsconfig.json`). CI runs both, in `.github/workflows/ui.yml`.

## What is being tested

`npm run build:e2e` is `vite build --mode e2e`: the bundle Vercel ships plus
MapView's instrumentation, `window.__map` and the `data-map-*` attributes on
`<html>`. The hooks are keyed on the build *mode*, which only a command line
sets, so no environment variable can switch them on in production.
`scripts/check-bundle.mjs` reads both bundles to prove it: none of the hooks
in `dist/`, all of them in `dist-e2e/`.

`NODE_ENV=production` is set in `playwright.config.ts`'s `webServer.env` and
nowhere else. A leaked `NODE_ENV=development` makes Vite build a development
bundle. Set at CI job level instead, it would make `npm ci` skip every
devDependency.

## The offline fixture

Every spec imports `test` from `support/offline.ts`, which routes every request
the browser makes, including a Web Worker's. MapLibre fetches vector tiles
from a worker, and `harness.spec.ts` proves those tiles were answered by the
fixture and never appeared on the page's own resource timeline.

| Request | Answer |
|---|---|
| `127.0.0.1` | the preview server. `net.hold('dataset')` can hold the dataset |
| CARTO style | `fixtures/carto-style.json`. `net.hold('style')` can hold it |
| CARTO TileJSON | `fixtures/carto-tilejson.json` |
| CARTO `.mvt` tiles | empty 200 |
| CARTO sprite | `{}` and `fixtures/sprite.png` (1x1) |
| CARTO glyphs | empty 200 |
| imagery, terrain | `fixtures/terrarium-flat.png`, RGB 128,0,0: sea level |
| the weather API | a fixed reading |
| anything else | aborted and listed in `net.unrouted` |

No host is written in the fixture. Each is derived from `src/lib/basemap.ts`,
`src/lib/scene.ts` or the style fixture. The two JSON fixtures were fetched
from CARTO once, on 2026-09-16. They keep CARTO's real source, sprite, glyph
and tile URLs, so the hosts the page contacts are the real ones. The style's
93 layers are cut to `background` and `water`, and the TileJSON's
`vector_layers` are cut to `water`. `node e2e/fixtures/make-pngs.mjs`
regenerates both PNGs.

`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1` sits underneath as a
second barrier. With it on, the load and journey below produced identical
route counts, no unrouted request and no console error, so fulfilled routes
are unaffected.

An init script seeds `localStorage` as a returning visitor would have it
(welcome panel seen, Celsius). The keys are imported from `src/lib/storage.ts`,
the one list the app writes through and the privacy page renders
(`support/source.ts` re-exports them). A spec opts out with
`test.use({ seedStorage: false })`.

## Measured before any threshold was written (2026-09-16)

Windows 11, Node 24.14, Playwright 1.63.0, `chromium_headless_shell-1243`,
WebGL renderer `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)
(0x0000C0DE)), SwiftShader driver)`.

**Baseline.** `npm ci --ignore-scripts` then `npm test` without `data/raw`:
674 tests, 673 pass, 1 skipped. The skipped test is
`scripts/countries.test.mjs`, *the nearest-country fallback picks the nearest
country*, and it skips with a stated reason because its Natural Earth file
lives in the gitignored `data/raw`. That is how it runs in CI. With `data/raw`
present, all 674 pass. `npm run data:build` left the tree byte-identical.

**CSS.** `src/index.css` now reads `@import 'tailwindcss' source('../src')`.
The built stylesheet went from sha256 `95a3003a…b076b` (105,458 bytes) to
`b3009e1a…56752` (104,790 bytes). Exactly ten rules disappeared and none
appeared: `.collapse .contents .hidden! .inline .table .shrink .grow .resize
.ring .invert`. None of them is a class anywhere in `src/`; they came from
words in the docs and scripts Tailwind used to scan. With `e2e/` present, the
old unscoped import still produced the baseline stylesheet exactly, so the
specs add nothing today. The scope is there so that stays true.
`index.html` carries no class names and needs no `@source`.

**Globe on arrival** (zoom 2, reduced motion). The radius is the largest
projected distance from the centre over 8 bearings and arcs of 0 to 90
degrees. Box coordinates are in canvas pixels.

| Viewport | Map canvas | Radius | Globe box x | Globe box y | Fits |
|---|---|---|---|---|---|
| 1440x900 | 1440x808 | 271.5 | 448.5 to 991.5 | 132.5 to 675.5 | yes, 132 px spare above and below |
| 1280x720 | 1280x628 | 258.6 | 381.4 to 898.6 | 55.4 to 572.6 | yes, 55 px spare above and below |
| 375x812 | 375x720 | 265.8 | -78.3 to 453.3 | 94.2 to 625.8 | **no**: 78 px past each side |

The canvas starts 59 px down, below the header. The footer takes 33.5 px.

**Footer links** (height 800). Positions are x, left to right edge.

| Width | Footer scrolls | Safety | Off-screen |
|---|---|---|---|
| 320 | yes, 373 in 320 | 12.0 to 50.9, clickable | **Source**, 319.9 to 361.1 |
| 375 | no | 13.0 to 51.9, clickable | none (Source ends at 362.0) |
| 800 | yes, 836 in 800 | 471.0 to 509.9, clickable | **Source**, 778.8 to 820.0, cut at the edge |
| 1100 | no | 735.0 to 773.9, clickable | none |
| 1440 | no | 1075.0 to 1113.9, clickable | none |

Below 640 px the key is hidden (`sm:flex`), and the page itself never
overflows: `documentElement.scrollWidth` equals the viewport at all five
widths. The footer scrolls inside itself. (All three were fixed on
2026-09-17; see "Track C" below.)

**Hosts contacted.** A cold load of `/` at any of the three viewports
contacts 6 hosts: `basemaps.cartocdn.com`, `tiles.basemaps.cartocdn.com` and
`tiles-{a,b,c,d}.basemaps.cartocdn.com`. The ten `.mvt` requests are fetched
from the worker. The journey was load, then the Radium card (1440x900, reduced
motion, so the camera jumps to zoom 12), then a cold deep link to Artists'
Paintpots at zoom 12. It adds `api.open-meteo.com`, `tiles.maps.eox.at` and
`s3.amazonaws.com`, 9 hosts in all, with 0 unrouted requests and 0 console
errors. Route counts for that journey: local 10, style 2, tilejson 2, tile 30,
sprite 4, glyphs 2, imagery 52, terrain 30, weather 1. Artists' Paintpots
opens no weather request, because a prohibited spring renders no scene.

## Mutations watched failing (2026-09-16)

A test that has not been watched failing is not done. Each row was applied,
run, read and reverted.

| Spec / test | Mutation | Observed |
|---|---|---|
| harness: the e2e build | `preview:e2e` serves `dist/` | `window.__map never appeared, so this is not the e2e build…` Received `"undefined"` |
| harness: WebGL | launch with `--disable-gpu --disable-software-rasterizer` | `no WebGL context … SwiftShader …` Received `null` |
| harness: every request intercepted | `.mvt` route removed from `offline.ts` | `no vector tile reached the fixture` Received `0` |
| boot: cold load | `Header` throws on render | `getByRole('banner')` element(s) not found |
| boot: cold load | style answered with a 404 | `MapLibre reported an error` Received `AJAXError: Not Found (404): https://basemaps.cartocdn.com/…/style.json` |
| boot: every record | `springs.slice(1)` in the store | `the map should hold all 7490 springs` Expected 7490, Received 7489 |
| welcome: shown once | `markSeen()` writes nothing | after reload, `toBeHidden()` Received `visible` |
| welcome: every exit | `dismiss()` removed from Show me one | `Show me one closed the panel without marking it seen` Expected `"1"`, Received `null` |
| footer: Safety on screen | the Safety link moved last in the nav | `the Safety link runs off the right edge` at 320 (Received 361.0) and 800 (820.0) |
| footer: each page opens | the Terms and Privacy anchors swapped | `toHaveAttribute` Expected `"/terms"`, Received `"/privacy"` (and the reverse) |
| footer: Download | href `data/hot-springs.json` | `the download is not data/hot-springs.geojson`: sha256 `48f1c718…` against `f402c90e…` |
| footer: the key from 640 | `sm:flex` -> `md:flex` | at 640, `toBeVisible()` Received `hidden` |
| deeplink: dataset before style | descent effect guarded on `!ready.current`, deps `[selectedId]` | `the camera never settled on Radium Hot Springs at zoom 12`; the style-first test passed |
| deeplink: style before dataset | deps `[mapReady]` only | the same message; the dataset-first test passed |
| deeplink: the flight settles | stage-2 `easeTo` removed | `the camera never settled … at zoom 12.5` |
| deeplink: unknown id | `replace: false` | `the dead link is still in history, one Back away` Expected 2, Received 3 |
| deeplink: Back and Forward | the `onPopState` effect removed | `Back changed the address and left the card open` |
| deeplink: prohibited | SoakScene guard is `true` | `figure[role=img]` Expected count 0, Received 1 |
| narrow: the page survives | `padding: … : undefined` passed to flyTo | `uncaught exceptions during the flight`: `Cannot read properties of undefined (reading 'top')`, the 2026-09-03 regression exactly |
| narrow: no sideways scroll | app root `w-full` -> `w-[400px]` | both widths fail `toEqual`. The first version compared against `innerWidth` and passed at 320, because a mobile viewport widens to fit overflow; it now compares against the width it set |
| narrow: the card fits | card `inset-x-0` -> `left-0 w-[420px]` | Expected `<= 375`, Received 420 |
| a11y: one h1 | the header's h1 -> h2 | Expected count 1, Received 0 |
| a11y: every button named | About button's `aria-label` removed | `button 3: <button …>` Expected pattern `/\S/`, Received `""` |
| disclosure: contacted is listed | open-meteo entry deleted from `THIRD_PARTIES` | `contacted api.open-meteo.com, …; listed basemaps.cartocdn.com, tiles.maps.eox.at, s3.amazonaws.com` |
| disclosure: listed is contacted | `bogus.example.org` added to `THIRD_PARTIES` | `listed …, bogus.example.org, …` |
| disclosure: nothing else stored | `main.tsx` writes a sessionStorage key | `toEqual` fails on `session` |
| globe: fits | `zoom: 2.3` in the constructor (the plan's mutation) | **passed**: at 2.3 the 1280x720 globe still fits, radius 304.0, y 10.0 to 618.0 in 628 |
| globe: fits | `zoom: 2.4` | `the globe is cut off at the top` at 1280x720, Received -6.4; 1440x900 still fits |
| screenshots | `<WelcomePanel />` removed from App | both welcome shots: `toBeVisible()` element(s) not found |
| citation: JSON-LD names the DOI (2026-09-17) | `identifier` removed from seo.ts | `the JSON-LD does not identify the dataset by its DOI` Received `undefined` |
| citation: JSON-LD names the DOI | `temporalCoverage` put back | `the JSON-LD dates the atlas by its OpenStreetMap layer` |
| citation: JSON-LD names the DOI | `version: '1.0.0'` added | `the live site claims a dataset version` |
| citation: About links the DOI | href set to a zenodo.org record | `toHaveAttribute` Expected the doi.org URL |
| citation: Terms names the archive | the caveat paragraph removed | `the Terms page no longer says /archived on Zenodo under a DOI/` |
| citation: DOI link wraps | `wrap-anywhere` removed from the link | `the DOI link runs past its paragraph` Expected <= 295.5, Received 326.9 (Verdana forced, 320 px) |

Pinned defects failed when fixed. Each was checked by applying a plausible fix
(all were fixed for real on 2026-09-17; see "Track C" below):

| Pin | Fix applied | Observed |
|---|---|---|
| D3 | `useState(() => !seen() && parse().kind === 'map')` | D3 `the greeting is over the deep link` not found; D3b and D8 failed too, as that fix also removes them |
| D4 | the panel returns null while a search or "near me" is active | `the first search result is under the greeting` Expected false, Received true |
| D8 | the Escape listener registered only while the panel is visible | `a panel the visitor never saw was marked seen` Expected `"1"`, Received `null` |
| D11 | the key group always `flex` | both widths: `a phone gets no key to the map colours` Received `visible` |
| D12, D12b | footer `flex-wrap`, nav `flex-wrap` without `shrink-0` | Source's right edge 164.2 at 320 and 784 at 800 |
| D1 | the wordmark span always `flex` | `the only h1 is display:none on a phone` Expected 0, Received 1 |
| D2 | `aria-label="Filters"` | Expected `""`, Received `"Filters"` |
| D9 | `inert={!open}` on the rail | `keyboard focus landed inside the closed, aria-hidden filter rail` (the pin now requires the hidden container to be the rail, found by its Filters heading) |
| D5 | the privacy page names `whs.welcomed` | `the privacy page names the welcome key` |
| D13 | `zoom: 1.2` below 640 px, `minZoom: 1` | `the globe runs off the left of a phone` Received 20.5 |

## Track C: the pins flipped (2026-09-17)

Every `known defect Dn` test is now an ordinary test of the intended
behaviour, in the same spec file. Each flipped test was watched failing with
its fix reverted (or, where noted, with the closest thing to a revert).

| Defect | Fix | Flipped test | Mutation | Observed |
|---|---|---|---|---|
| D1 | wordmark span `sr-only md:not-sr-only` (Header.tsx) | a11y: exactly one h1 at 375 and 1440 | span back to `hidden md:flex` | at 375, `the accessibility tree has no single h1` Expected 1, Received 0 |
| D1 | `scripts/a11y.test.mjs` walks the tags around the h1 | the h1's wrapper is never `hidden` | the same | `` `hidden` on <span className="hidden min-w-0 … hides the h1 with it `` |
| D2 | `aria-label="Filters"` | a11y: every button named at 375 and 1440, Filters named once | label removed | at 375, `button 0: <button aria-pressed="false" …` Expected `/\S/`, Received `""` |
| D9 | `inert={!open}` on the rail | a11y: Tab never lands in the closed rail, and reaches it once open | `inert` removed | `keyboard focus landed inside the closed, aria-hidden filter rail` |
| D3, D3b | WelcomePanel opens only if the arrival address was the map (`parse()`, read once at module load); a deep-link visit does not mark it seen | welcome: a cold deep link never shows it (MutationObserver from the first byte, dataset held); closing a deep-linked card does not bring it up, and `/` still does | initial state `!seen()` again | `/s/whs_ce8611720825: the greeting was over the deep link while the dataset was held`; `the greeting appeared after the visitor had already used the atlas` |
| D8 | the Escape listener is registered only while the panel is visible | welcome: Escape meant for a page covering the panel leaves it unseen, and it comes back | listener keyed on `open` again | `a panel hidden behind the page was marked seen` Received `"1"` |
| D4 | a search or the header's Near me dismisses the panel and marks it seen (Hudson's decision) | welcome: search, and Near me with geolocation granted at Radium: panel gone, `whs.welcomed` set, first result hit-testable | the dismissing effect made a no-op | `the greeting is still up over the search` / `… over the nearest springs`, Received visible |
| D5 | `src/lib/storage.ts` lists every key; store and panel import from it; the privacy page renders it; `POLICY_UPDATED` 2026-09-17 | disclosure: every key a first visit writes is named on the page, and every named key was written | welcome entry deleted from `STORAGE_KEYS`; a `whs.bogus` entry added | `written whs.units, whs.welcomed; named whs.bogus, whs.units` → `["whs.welcomed"]`; `named whs.bogus, whs.units, whs.welcomed; …` → `["whs.bogus"]` |
| D5 | `scripts/storage.test.mjs` | no key literal or literal web-storage call outside storage.ts | `localStorage.getItem('whs.welcomed')` in WelcomePanel | `… types the key whs.welcomed; import it from lib/storage.ts` |
| D10 | `shareAsFraction` and `numberWords` in lib/format.ts, used by the footer (loaded records), the welcome panel (summary.json), the Terms page and docs.test.mjs | `scripts/format.test.mjs` | `shareAsFraction` returns `{4, 5}`; `"4 in 5"` typed back into the footer | `Expected values to be strictly deep-equal` (5/6); `AtlasFooter.tsx types the unknown share` |
| D11 | compact key row below 640 px, from `TEMP_BANDS` via `bandRange` | footer: the key is visible with all six colours and names at 320, 375, 640, 800, 1100, 1440 | key group `hidden … sm:flex` again | at 320 and 375, `the map colours have no key at this width` Received hidden |
| D12, D12b | footer two rows on a phone, links wrap under the key from 640 to 1023, no `overflow-x-auto` | footer: in °C and °F at 320-1440, every link inside the viewport and hit at its centre, no sideways scroll | the old single `overflow-x-auto` row, no wrapping | 8 of 12 fail: e.g. `Safety runs off the right edge` 323.4 at 320, `Source runs off the right edge` 820 at 800 |
| D13 | `frameArrival()` fits the globe with 12 px to spare, never above zoom 2; refit on resize only while untouched | globe: fits at 1440x900, 1280x720, 375x812, 320x640; desktop zoom is 2; a phone turned sideways still fits | `frameArrival` not called; `ARRIVAL_ZOOM` 1.9; the resize listener disconnected | `the globe is cut off on the left` -76.6 and -88.5; `a desktop no longer arrives at zoom 2` Received 1.9; `the globe no longer fits once the phone is sideways` |
| D11, review | the phone key's ranges are tested, from `bandRange` in lib/format.ts (moved there from the footer so the spec reads the same function) | footer: the phone key prints every band's range, in order, at 320 and 375 in C and F | the phone range span hidden | `the phone key does not show <30, or not in band order` (and `<86` in F) |
| review: the greeting after the filters | WelcomePanel stays mounted while the rail is open, and opening the filters dismisses it for good, like a search | welcome: opening the filters closes the welcome panel for good | the old `{!filtersOpen && <WelcomePanel />}` with no filters dismissal | `opening the filters closed the greeting without marking it seen` Received null |
| D10, review | `shareAsFraction` searches every fraction up to tenths, not only N in N+1; `springsInWords` writes the sentence, singular included | format.test: plainest fraction, honest from 5% to 95%; a share opens a sentence | the old N-in-N+1 search | 2 failures: 10% came out as `{ part: 1, whole: 2 }`, and `springsInWords(0.1)` as `One spring in two` |

**Footer, measured after the fix** (Windows, height 800). Positions depend on
the system font and are not pinned.

| Width | Footer height | Links row | Key contents (°C / °F) |
|---|---|---|---|
| 320 | 56 (two rows) | 17.0 to 303.0, one row | 256.5 / 290.7 in 296 |
| 375 | 56 | 44.5 to 330.5 | 302.9 / 337.1 in 351 |
| 640, 800 | 54 (links under the key) | 275.0 to 624.0; 435.0 to 784.0 | 439 / 463 |
| 1024 to 1440 | 33.5 (one row) | ends 16 px from the edge | unchanged from before |

Before the key row gave up the word "Water" below 375 px and its gaps were
narrowed to 6 px, it needed 314 (°C) and 348 (°F) in 296 at 320; the links
needed 306 and wrapped until the gaps went to 2 px and "Download the data"
became "Download" on a phone (its accessible name is still the whole phrase).
The key row wraps rather than overflows if a wider font needs it.

**Globe, measured after the fix:** 375x812 arrives at zoom 1.291 (radius
175.5 in a 375x697 canvas), 320x640 at 1.074 (148.0 in 320x525); 1440x900
and 1280x720 are unchanged at zoom 2.

**Counts:** `npm test` 717; `npm run test:e2e` 86 tests in 11 specs (after rebasing on the DOI wiring, which added `citation.spec.ts`, and the review fixes).

## Load

`workers: 2`. At Playwright's local default of half the cores (7 on a
14-core machine) the full suite failed 12 and then 13 of 63 on 2026-09-16,
every failure a timeout: a card or an idle map that takes about a second
alone took more than 5 or 30 seconds with seven SwiftShader renderers
competing. Two is what a four-core GitHub runner gets by default.
