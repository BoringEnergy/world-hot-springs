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
(welcome panel seen, Celsius). The keys are read from the source that defines
them (`support/source.ts`). A spec opts out with
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
widths. The footer scrolls inside itself.

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

Pinned defects fail when fixed. Each was checked by applying a plausible fix:

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

## Load

`workers: 2`. At Playwright's local default of half the cores (7 on a
14-core machine) the full suite failed 12 and then 13 of 63 on 2026-09-16,
every failure a timeout: a card or an idle map that takes about a second
alone took more than 5 or 30 seconds with seven SwiftShader renderers
competing. Two is what a four-core GitHub runner gets by default.
