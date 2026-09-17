# Plan: Zenodo DOI + Playwright browser harness (hardening toward a citable source)

## Context

The cowork session (commit `cda3c35`) shipped a masthead, footer, key and welcome panel, and named three things between the atlas and "reputable source": no DOI, no browser test harness, no dataset changelog. Hudson asked for **the DOI and the Playwright harness next**, with agents ready to take the work in parallel.

This session's read-only exploration (three explorers plus a design review, all checked against code, `node_modules`, Zenodo's source and `gh api`) found things that change how both jobs are done:

- **Zenodo licence.** GitHub reports this repo's licence as `NOASSERTION`, so without an explicit `.zenodo.json` Zenodo would publish the dataset as **CC BY 4.0** and label it software. `.zenodo.json` takes precedence over `CITATION.cff` and replaces Zenodo's defaults wholesale.
- **CI blocks the harness.** `scripts/workflows.test.mjs:86-91` forbids `npm ci` in every workflow, so the harness needs a deliberate, narrowly scoped rule change. Nothing in CI runs `npm test` today.
- **Instrumentation is dev-only.** The `data-map-*` / `window.__map` hooks exist only under `import.meta.env.DEV`, and MapLibre needs WebGL, with no React error boundary.
- **Defects already visible in the code.** Reading it turned up about 9 behavioural defects the source-scan tests cannot see: no h1 below 768px, an unnamed Filters button below 640px, the welcome panel flashing over cold deep links and covering search results, the privacy page understating what is stored, and a rail reachable by Tab while `aria-hidden`.
- **Stale text would be archived.** README's US/rest-of-world figures (1,097 / 171) and "five in six" are wrong against today's data. The LICENSE data note still credits OSM alone. `docs/DATA.md` lists 3 upstreams. All of it would be frozen into the DOI archive.
- **Unchanged data.** The published data is byte-identical to the v1 declaration (`0a72527`), so the first DOI is honestly **v1.0.0**.

### Decisions made by Hudson today

| Question | Decision |
|---|---|
| Personal email in `main` history (12 authored commits, 98 committer entries) | Don't rewrite. Hudson turns on GitHub's **"Block command line pushes that expose my email"**. Tag anyway. |
| DOI creator | **Hudson R&D** (no personal name) |
| Immutable archive vs PRIVACY.md | **Disclose it in PRIVACY.md and Terms, and add a release checklist step:** no pending removal request at release time. If a request later covers an archived version, ask Zenodo to restrict those files. |
| Delivery | **PRs, two tracks in parallel** (plus a fix-up PR) |
| Browser harness | The 2026-09-11 decision that "Layer C (a React render harness) is declined" is **reversed** on 2026-09-16. Record it in HANDOFF. |

### Corrections to the cowork report (tell Hudson; record in HANDOFF)

- **`git gc` will not clear `.git/lock-trash/`.** gc ignores unknown files in `.git/`, so the folder has to be deleted by hand.
- **`NODE_ENV` is unset** in this machine's shells (process, User and Machine scope). The leak came from the cowork host process. The harness pins it in `webServer.env` regardless.
- **Branch protection requires no reviews** (`reviews: null`), only `validate` + `gate-2 claims`, strict. PRs can merge normally once green, so `--admin` isn't needed. HANDOFF's "1 review" line is stale.
- **No tags exist on the remote.** `backup-pre-email-rewrite` is local-only and its commits use noreply addresses. Never run `git push --tags`.

## Sequencing and who does what

```
A1 release-metadata  ─┐ (parallel)
B  browser-harness   ─┴─> B rebases on A1 ──> R release v1.0.0 ──> A2 wire-the-DOI
                                   └──> C harness-fixes (parallel with R)
```

- **Step 0 (me).** Commit this plan as `docs/superpowers/plans/2026-09-16-doi-and-browser-harness.md`, on its own PR or folded into A1.
- **Agent 1 → A1**, branch `release-metadata`, in its own worktree.
- **Agent 2 → B**, branch `browser-harness`, in its own worktree. After A1 merges it rebases and regenerates the lockfile with `npm install`.
- **Agent 3 → C**, after B merges, with one commit per defect.
- **Me:** coordinate, review each PR with `/code-review`, spot-check the named mutations, run R with Hudson, then do A2.

**Shared-file conflicts to expect:**

| File | Touched by |
|---|---|
| `package.json`, `package-lock.json` | A1 (version bump), B (devDependency and scripts) |
| `docs/superpowers/HANDOFF.md` | Each PR appends its own section |
| `src/components/LegalPages.tsx` | C (D5), then A2 (Terms caveat), in that order |
| `.gitignore`, `src/index.css` | B only |

**House rules every agent follows** (from HANDOFF):
- Run `data:build` before `npm test`.
- Stage explicit paths; never `git add -A`.
- Every test gets its named mutation applied and must be *watched failing*, then reverted.
- Measure before writing any threshold.
- Derive facts; never write a second copy of one.
- Read `specs/2026-08-25-gate-2-trigger-security.md` before touching `.github/`.

## A1 — PR "release metadata" (no DOI yet)

1. **Measure first.** Record the current `dist/assets/index-*.css` sha256 and the `git archive --format=zip HEAD | wc -c` size (3,971,829 bytes today).
2. **`src/lib/citation.ts` (new leaf module, no imports).** It is the one definition of:
   - `TITLE`, `SITE_ORIGIN`, `REPO_URL`, `KEYWORDS`, and a timeless `DESCRIPTION`
   - `CREATORS = [{ name: 'Hudson R&D' }]`
   - `CONCEPT_DOI: string | null = null`

   `AtlasFooter.tsx:27` and `seo.ts` import from it instead of restating those values.
3. **`scripts/build-citation.mjs` (new).**
   - Use the `pathToFileURL(process.argv[1])` main guard, as in `build-sitemap.mjs`.
   - It reads `citation.ts`, `scripts/lib/sources.mjs` (`UPSTREAMS`), `data/summary.json`, `package.json`, and the top released `CHANGELOG.md` entry.
   - It writes **`.zenodo.json`** (`JSON.stringify(…, null, 2) + '\n'`) with these fields:
     - Fixed values: `upload_type: "dataset"`, `license: "odbl-1.0"`, `access_right: "open"`.
     - `title`, `creators`, `keywords`.
     - `description`, with counts taken from the summary.
     - `version` and `publication_date`, both from CHANGELOG. Setting the date explicitly avoids Zenodo's UTC day rollover.
     - `notes`: code is MIT; data is ODbL; every upstream whose licence requires attribution, with that attribution (AIST); and this version's CHANGELOG section.
     - `related_identifiers`, each with a `relation` (a missing key fails the release):
       - `isDerivedFrom` for each upstream URL; NCEI's is `https://doi.org/10.25921/c8p0-zs06`.
       - `isSupplementTo` for `${REPO_URL}/tree/v${version}`. Supplying the list drops Zenodo's automatic tag link, so the file must re-add it.
       - `isDocumentedBy` for `${REPO_URL}/blob/v${version}/DATA.md`.
       - `isSourceOf` for `SITE_ORIGIN`.
   - It also writes **`CITATION.cff`** from a hand template in which every scalar is `JSON.stringify`-quoted. This needs no YAML dependency. The author is the Hudson R&D entity, with website `https://hudsonrnd.com`.
   - `build-sitemap.mjs` exports `DEFAULT_ORIGIN`. It must not import `.ts`, because it runs in the Vercel build.
4. **`package.json`.**
   - Add `"release:meta": "node scripts/build-citation.mjs"`.
   - Append `&& node scripts/build-citation.mjs` to `data:build`.
   - Run `npm version 1.0.0 --no-git-tag-version --ignore-scripts`.
5. **Docs.**
   - `CHANGELOG.md`: dataset-first. State the versioning policy: MAJOR = schema break, MINOR = records or fields added or removed, PATCH = corrections. The v1.0.0 entry is dated on release day and states that the data is byte-identical to `0a72527`, where v1 was declared on 2026-09-11.
   - `docs/RELEASING.md`: the runbook in section R.
   - `LICENSE` data note: defer to DATA.md and state ODbL.
   - `docs/DATA.md`: replace the stale table with a link to `../DATA.md`, and add the WQP and NBMG stages to its diagram.
   - `README.md` lines 54 and 60-63: derive the correct figures.
   - `PRIVACY.md`: add an "Archived versions" paragraph.
   - `.gitattributes`: add `.claude/ export-ignore`. Leave `.gstack/` alone, because test comments cite it.
   - HANDOFF: fix the stale branch-protection line.

**Tests.** Each test fails under its named mutation.

`scripts/citation.test.mjs`:

| Test asserts | Mutation that must fail it |
|---|---|
| Committed `CITATION.cff` and `.zenodo.json` equal the generator's output | Hand-edit `version` |
| `license` is `odbl-1.0` | Delete `license` from the generator |
| `upload_type` is `dataset` | Drop `upload_type` |
| Every relation is in DataCite's list and every identifier is https | `isDerivedFrm` |
| The tag-tree link is present | Remove that entry |
| Upstream credits match `UPSTREAMS` in both directions | `UPSTREAMS.slice(1)` |
| Version and date match CHANGELOG, and `package.json` agrees | Bump `package.json` only |
| `creators` is non-empty | Set it to `[]` |
| `notes` carry MIT, ODbL and the AIST condition | Drop the AIST sentence |
| `CITATION.cff` scalars are quoted | Emit an unquoted value containing `": "` |
| The origin is a single fact: `DEFAULT_ORIGIN`, `robots.txt`, and the footer import all agree | Edit the `robots.txt` host |

`scripts/docs.test.mjs` additions:

| Test asserts | Mutation that must fail it |
|---|---|
| The README's US/rest-of-world sentence matches a recount of `data/hot-springs.json` | Revert line 60 |
| The README's unknown share is derived from the summary | Revert line 54 |
| LICENSE defers to DATA.md | Restore the old paragraph |
| `docs/DATA.md` has no table and its diagram names every `scripts/lib/*-match.mjs` | Delete the WQP line |
| PRIVACY.md mentions archived versions | Delete the paragraph |
| `.gitattributes` export-ignores `.claude/` | Remove the line |

## B — PR "browser harness"

**B0 — measure before choosing any threshold.** Record the numbers in spec comments:
- A clean `npm ci --ignore-scripts && npm test && npm run build`.
- The CSS hash before and after.
- The globe's projected radius and the canvas box at 1440×900, 1280×720 and 375×812.
- The footer link boxes at 320, 375, 800, 1100 and 1440.
- The full list of hosts contacted.

**B1 — setup**

- **Dependency.** `npm install -D -E @playwright/test@1.63.0` (the latest version, verified).
- **Scripts**
  - `build:e2e`: `vite build --mode e2e --outDir dist-e2e --emptyOutDir`
  - `preview:e2e`: `vite preview --outDir dist-e2e --host 127.0.0.1 --port 4173 --strictPort`
  - `test:e2e`: `playwright test`
  - `test:e2e:install`: `playwright install --with-deps --only-shell chromium`
  - `typecheck:e2e`: `tsc -p tsconfig.e2e.json`
- **`playwright.config.ts`**
  - `testDir: 'e2e'` must be set explicitly. The default directory would pick up `scripts/**/*.test.mjs`.
  - Chromium only, `retries: 0`.
  - `use`:
    - `baseURL: 'http://127.0.0.1:4173'`
    - `locale: 'en-GB'`, `timezoneId: 'UTC'`
    - `reducedMotion: 'reduce'`
    - `serviceWorkers: 'block'`
  - Optionally add the `--host-resolver-rules` launch argument (`MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`), but keep it only if fulfilled routes still work with it. Playwright 1.63 already passes `--enable-unsafe-swiftshader`.
  - `webServer`:
    - `command`: `npm run build:e2e && npm run preview:e2e`
    - `env: { NODE_ENV: 'production' }`. Set it here only: at job level it would make `npm ci` skip devDependencies.
    - `timeout: 180_000`, `reuseExistingServer: false`
  - Reporters: `list`, `html {open:'never'}`, plus `github` on CI.
- **`tsconfig.e2e.json`** covers `e2e/` and `playwright.config.ts`. Do *not* reference it from `tsconfig.json`, so an e2e type error cannot break the Vercel deploy.
- **`.gitignore`** gains `dist-e2e/`, `playwright-report/`, `test-results/`, `blob-report/`, `playwright/.cache/` and `Claude outputs/`.
- **`src/index.css`** switches to `@import 'tailwindcss' source('../src');`. Otherwise Tailwind scans the new specs and docs and adds CSS. Add `@source` for `index.html` if it carries classes, and confirm the CSS diff removes only unused utilities.
- **`MapView.tsx`**
  - Add `const INSTRUMENT = import.meta.env.DEV || import.meta.env.MODE === 'e2e'` and use it at all four gates (lines 157, 539, 656, 687).
  - Keying on the mode, not an env var, means nothing leaking from a shell or Vercel can ship the hooks.
  - Delete `data-map-source-features`; tests read `getSource('springs').getData()` instead.
- **`scripts/check-bundle.mjs`** (plus `check-bundle.test.mjs`)
  - It derives the instrumentation markers (`__map` and every `dataset.map*` key) from `MapView.tsx`.
  - `node scripts/check-bundle.mjs dist` must find none of them.
  - `node scripts/check-bundle.mjs dist-e2e --expect-present` must find all of them.
  - It fails if the directory is missing.
  - Mutation: `findMarkers` returns `[]`.

**B2 — `e2e/support/offline.ts`**

A `test.extend` fixture that routes `context.route('**/*')`. Playwright 1.63 routes worker requests in Chromium, and MapLibre fetches `.mvt` tiles from workers.

| Request | Handling |
|---|---|
| `127.0.0.1` | `continue`, with an optional gate on the dataset |
| CARTO style | Gated; served from `e2e/fixtures/carto-style.json`. That file keeps the **real** CARTO `sources`/`sprite`/`glyphs` URLs, so the disclosure test sees real hosts, but trims the layers to `background` + `water`. |
| TileJSON | Fixture carrying the real `tiles-a..d` URLs |
| `.mvt` tiles | Empty 200 |
| Sprite | `{}` plus a 1×1 PNG |
| Glyphs | Empty 200 |
| EOX and AWS terrarium | `e2e/fixtures/terrarium-flat.png` (RGB 128,0,0) |
| open-meteo | Fixed JSON |
| Anything else | Abort and record |

- The fixture records every host and counts requests per route.
- An init script seeds `whs.welcomed=1` and `whs.units=c` unless a spec opts out. Only the welcome spec does.
- Record ids are read from `scripts/fixtures/cards.json`; don't restate them. Examples: Radium `whs_ce8611720825`, Artists' Paintpots `whs_72b506bb5baa`.
- Page titles, temperature bands and third-party hosts are imported from `src/`.

**B3 — specs.**
- **Pinned defects:** each known defect gets an ordinary test named `known defect Dn: …` that asserts the *current* buggy state. It fails loudly if the harness breaks *and* when the defect is fixed. Don't use `test.fail()`: it also passes when a precondition breaks.
- **Motion:** specs that exercise `flyTo` padding use `reducedMotion: 'no-preference'`, because the reduced-motion `jumpTo` never receives padding.

- **`harness.spec.ts`**

  | Test | Mutation that must fail it |
  |---|---|
  | The server is the e2e build (`__map` is present) | Serve plain `dist/` |
  | WebGL is available; the failure message names SwiftShader | `--disable-gpu --disable-software-rasterizer` |
  | Every third-party request is intercepted, including worker `.mvt` requests (count > 0, no unrouted host) | Remove the `.mvt` route |

- **`boot.spec.ts`**

  | Test | Mutation that must fail it |
  |---|---|
  | Cold `/` renders header, main and footer, with no pageerror, no `data-map-error`, only allowlisted console errors, and the default title. MapLibre stops console-logging once a listener exists, so `data-map-error` must be checked directly. | Throw in `Header`; serve a 404 for the style |
  | The springs source holds `summary.total` features | `springs.slice(1)` |

- **`welcome.spec.ts`** (no seeding)

  | Test | Mutation that must fail it |
  |---|---|
  | Shown once | `markSeen` does nothing |
  | Every exit dismisses it: Open the map, Close, Escape, Show me one, the Safety link | Remove `dismiss()` from Show me one |

  Pinned defects:
  - **D3:** shown over a cold `/s/<radium>` and over `/terms` while the dataset is gated (detected with a MutationObserver).
  - **D3b:** closing a deep-linked card reveals it.
  - **D4:** it covers a search result (checked with `elementFromPoint`).
  - **D8:** pressing Escape while it is hidden writes `whs.welcomed`.

- **`footer.spec.ts`**

  | Test | Mutation that must fail it |
  |---|---|
  | At 320–1440px, the Safety link is in the viewport and receives the click. Any other off-screen link is pinned only if B0 measured it. | — |
  | Safety, About, Terms and Privacy, by click and by cold load, show the right heading and title | Swap the Terms and Privacy hrefs |
  | Download returns 200 with a sha256 equal to `data/hot-springs.geojson` | Change the href to `.json` |
  | From 640px up, the key shows 6 swatches (from `TEMP_BANDS`) | `sm:flex` → `md:flex` |

  Having no key below 640px is a product decision, not a defect: record it and ask Hudson.

- **`deeplink.spec.ts`**

  | Test | Mutation that must fail it |
  |---|---|
  | A cold deep link opens the card, sets the title and lands on the record, with the style gated to arrive *after* the dataset | Guard `!ready.current` with deps `[selectedId]` — the race `cda3c35` fixed |
  | The same, with the dataset gated to arrive *after* the style | Deps `[mapReady]` only |
  | With motion on, the flight settles near zoom 12.5 on the record | Remove the stage-2 `easeTo` |
  | An unknown id becomes `/` with no history entry | `replace: false` |
  | Back and Forward close and reopen the card | Remove the `onPopState` effect |
  | Artists' Paintpots shows "Do not enter the water" and no `figure[role=img]` | The SoakScene guard becomes `true` |

- **`narrow.spec.ts`** (375×812, `isMobile`, motion on)

  | Test | Mutation that must fail it |
  |---|---|
  | Selecting a search result keeps the page alive and shows the card (the 2026-09-03 regression) | `padding: … : undefined` |
  | No horizontal overflow at 320 and 375 | Pin instead if B0 measured an overflow |
  | The card lies within the viewport and its close button is hit-testable. It is full-width below `lg`, so "width ≤ viewport − 24" is not the right check. | — |

- **`a11y.spec.ts`**

  | Test | Mutation that must fail it |
  |---|---|
  | Exactly one h1 at 1440 | h1 → h2 |
  | Every button has an accessible name at 1440 | Remove the About button's `aria-label` |

  Pinned defects:
  - **D1:** no h1 at 375.
  - **D2:** the Filters button is unnamed at 375.
  - **D9:** Tab reaches the closed filter rail (`aria-hidden` without `inert`).

- **`disclosure.spec.ts`** (journey: load → card → deep link to z12)

  | Test | Mutation that must fail it |
  |---|---|
  | Every contacted host is listed on the rendered `/privacy` page (dot-boundary suffix match) | Delete the open-meteo entry |
  | Every listed host is actually contacted | Add a bogus host |
  | sessionStorage, cookies, indexedDB and caches are all empty | — |

  Pinned defect **D5:** `whs.welcomed` is not named on the privacy page.

- **`globe.spec.ts`:** on arrival, the whole globe fits inside the map canvas.
  - Measure with the maximum `__map.project` distance over 8 bearings × 0–90° arc.
  - Use the viewports B0 measured; record 375×812 as-is.
  - Mutation: constructor `zoom: 2.3`.
- **`screenshots.spec.ts`:** attach 375×812 and 1440×900 shots of the welcome panel, the map, a card and `/safety`, with no pixel comparison. No web font is loaded and SwiftShader output varies by OS. Use `page.clock.setFixedTime`, not `install`.

**B4 — CI (`.github/workflows/ui.yml`)**

- **Identity.** `name: ui`, job `browser`. Never `gate-1`, `validate` or `gate-2 claims`.
- **Triggers.** `pull_request`, `push: [main]` and `workflow_dispatch`, with no path filters, so the check can be made required later.
- **Permissions.** Top-level `permissions: contents: read` only.
- **Run limits.** Concurrency group per ref, `timeout-minutes: 25`.
- **Steps:**
  1. checkout at the existing SHA pin, with `persist-credentials: false`
  2. setup-node at the existing pin, Node 24, **no cache**
  3. `npm ci --ignore-scripts` (verified safe: only esbuild and fsevents have install scripts, and esbuild resolves its binary without one)
  4. `npm test`, which closes the gap that CI never ran it
  5. `npm run build`
  6. `node scripts/check-bundle.mjs dist`
  7. `npm run typecheck:e2e`
  8. `npm run test:e2e:install`
  9. `npm run test:e2e`
  10. `node scripts/check-bundle.mjs dist-e2e --expect-present`
  11. `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1` (a verified commit), with `if: ${{ !cancelled() }}` and `retention-days: 14`, uploading the report and `test-results/`
- **Rules.** Use npm scripts, not `npx`. No `${{ github.event.* }}` inside `run:`.
- **Status.** Advisory until the flake rate is measured.

`scripts/workflows.test.mjs` replaces lines 86-91 with these tests:

| Test asserts | Mutation that must fail it |
|---|---|
| `npm install` appears nowhere | Add it to `ui.yml` |
| `npm ci` appears only in `NPM_CI_ALLOWED = ['ui.yml']`, and always with `--ignore-scripts` | Drop the flag |
| An allowed file has exactly one `permissions: contents: read`, allowed triggers only, `persist-credentials: false` on every checkout, no `workflow_run`, a name other than `gate-1`, and no job named `validate` or `gate-2 claims` | Add `pull-requests: write` |
| `gate.yml` and `gate-2.yml` contain no npm directive | Add `npm test` to gate-2 |
| No `download-artifact` anywhere | Add it |
| Only `gate-2.yml` uses `workflow_run` | Add it to `ui.yml` |
| No `actions/cache` and no setup-node `cache:` (require `package-manager-cache: false` if setup-node reaches v5 or later) | Add `cache: npm` |
| No `npx` in any workflow | `npx playwright test` |

**New spec: `docs/superpowers/specs/2026-09-16-browser-harness-ci.md`.** It records:
- Why the npm rule moved: fork runs are unprivileged, secret-less and use a read-only token, and all external contributors need approval (F10).
- **Cache poisoning:** a compromised dependency in a `push: main` run could write main-scope caches, hence no caches at all.
- **Hostile reports:** never open a fork PR's Playwright report.
- **Approving fork runs:** read the PR's file list before approving its workflow runs.
- That the workflow test protects the maintainer from mistakes, not the repo from an attacker.

**B5 — docs.**
- CONTRIBUTING "Working on the code": add the e2e commands.
- HANDOFF:
  - The Layer C reversal.
  - The CI description, now three workflows.
  - The measured test count.
  - The `--mode e2e` and `NODE_ENV` notes.
  - The `.git/lock-trash` correction.
- Update the "there is no browser here" comments in `a11y.test.mjs`, `mapview.test.mjs` and `permalink.test.mjs`.

## C — PR "fix what the harness caught" (after B)

Before writing each fix, decide the intended behaviour. Each fix then flips its pinned test to the intended assertion.

| Defect | Fix |
|---|---|
| D1 — no h1 below 768px | Move the h1 out of the `hidden md:flex` span (`Header.tsx:70`). Tighten `a11y.test.mjs:34-45`, which currently passes over this. |
| D2 — Filters button unnamed below 640px | `aria-label="Filters"` |
| D3 / D3b — welcome over cold deep links | `useState(() => !seen() && parse().kind === 'map')` in `WelcomePanel.tsx:73` |
| D4 — welcome covers search results | **Hudson decided: a search or Near me closes the welcome and marks it seen**, like "Open the map". Fix the misleading comment at `App.tsx:65-69`. |
| D5 — privacy page understates storage | New `src/lib/storage.ts` exporting `STORAGE_KEYS`, used by the store, WelcomePanel and the Privacy page. Bump `POLICY_UPDATED`. |
| D8 — Escape while hidden marks the welcome seen | Register the Escape handler only while the panel is visible |
| D9 — closed filter rail reachable by Tab | `inert={!open}` on the rail (`FilterRail.tsx:80`) |
| D10 — coverage phrase hard-coded | Derive the "4 in 5" text in `AtlasFooter.tsx:97` and `WelcomePanel.tsx:151` from summary data |
| D11 — no temperature key below 640px (**Hudson decided 2026-09-16: phones get a compact key**) | Always-visible compact key below `sm`: one row of the five band swatches plus "No reading", each with a short range in the current unit (e.g. `<30 · 30–38 · 38–43 · 43–50 · 50+ · —`), bands from `TEMP_BANDS`. The footer becomes a key row plus a links row on phones. Measure at 320 and 375 first: it must fit with no horizontal scroll, and Safety must stay visible and hit-testable. The footer spec's "no key below 640" note becomes the assertion "the key is visible and names every band at 320–1440". |

Footer overflow and globe fit are fixed only if B0 measured a failure.

## R — Release v1.0.0 (Hudson's actions, each confirmed in chat)

**1. One-time setup (Hudson).**
- Turn on GitHub → Settings → Emails → **"Block command line pushes that expose my email"**.
- Grant the Zenodo OAuth app access to the **BoringEnergy** org.
- On zenodo.org → GitHub, click **Sync now** and toggle the repo **ON** *before* the release is published.

**2. Recommended dry run.**
- Connect `sandbox.zenodo.org` to the `HudsonR-D/world-hot-springs` fork and push A1 there.
- Publish a throwaway release, then check the sandbox record's licence (ODbL), type (dataset), creator, related identifiers and notes.
- Zenodo registers "Hudson R&D" as a *person*, because it ignores the creator `type` field. Check whether it can be switched to Organisation in Zenodo's edit screen; if so, add that step to RELEASING.md for every version.
- Delete the fork's release and tag afterwards.

**3. Preconditions.**
- No pending removal requests.
- `ui` and the required checks are green on the target SHA.
- The CHANGELOG date equals today's UTC date; if it doesn't, regenerate and merge first.

**4. Create the release** (only after Hudson's explicit yes):
```
gh release create v1.0.0 --target <sha> --title "World Hot Springs 1.0.0" --notes-file <changelog-section>
```
Don't use `--generate-notes`, don't mark it as a prerelease, and never run `git push --tags`.

**5. Verify.** Check the Zenodo record. Optionally change the repo homepage from `world-hot-springs.vercel.app` to `https://whs.boring.energy`.

## A2 — PR "wire the DOI" (after the record exists)

- **`citation.ts`:** set `CONCEPT_DOI`, then run `release:meta`. `CITATION.cff` gains `doi` and `identifiers`.
- **README:** add a "How to cite" section and a concept-DOI badge. Keep the pinned strings byte-identical.
- **`seo.ts`:** give the Dataset JSON-LD `identifier: https://doi.org/<concept>` and a `citation`.
  - **No `version`:** the site deploys unreleased main.
  - **Delete the dead `facts` parameter and `temporalCoverage` branch.** It contradicts the About panel's rule about the OSM date. Update the 5 call sites in `useStore.ts`.
- **`AboutPanel.tsx`:** add a "Cite this dataset" block with a plain doi.org link and no badge image, which would add a third-party host.
- **`LegalPages.tsx`:** add the archive caveat to the Terms removal paragraph and bump `POLICY_UPDATED`.

**Tests**

| Test asserts | Mutation that must fail it |
|---|---|
| Node: the DOI in CITATION, README and `CONCEPT_DOI` agree | A README typo |
| e2e: the JSON-LD carries the DOI and licence, and has no `temporalCoverage` | Remove `identifier`; re-add `temporalCoverage` |
| e2e: the About citation link points at the DOI | Wrong href |
| The disclosure test still passes | — |

## Flag as separate tasks (spawn chips after approval; out of scope here)

- **Required-check spoofing (possible).** `gate-2 claims` is matched by name, pinned only to the GitHub Actions app (15368). A fork workflow with a job of that name might produce a satisfying check, and F10 approval plus reading the file list are the only barriers. This predates this work and needs investigation.
- **`gate-2.yml` ignores gate-1's conclusion.** Its `if:` never checks it, unlike the spec's version. HANDOFF line 704 ("a failed gate-1 means workflow_run never fires") is wrong.
- **Product question for Hudson:** there is no temperature key below 640px, the width where the footer was supposed to explain the colours.

## Verification

```bash
# A1
npm run data:build && npm test && npx tsc -b --force && npm run build
npm run release:meta && git diff --exit-code CITATION.cff .zenodo.json
git archive --format=tar HEAD | tar -t | grep -E '^(\.claude/|data/private/)'   # expect nothing

# B (local, Windows)
npm ci --ignore-scripts && npm test && npm run build && node scripts/check-bundle.mjs dist
npm run typecheck:e2e && npm run test:e2e:install && npm run test:e2e
node scripts/check-bundle.mjs dist-e2e --expect-present
# mutation loop: apply each named mutation, run that spec, watch it fail, revert; confirm git is clean

# CI proof (a workflow that has never run is a hypothesis)
gh run list --workflow ui --limit 5          # ui ran on the B PR, and failed/passed for the right reasons
gh api repos/BoringEnergy/world-hot-springs/branches/main/protection --jq .required_status_checks

# R / A2
gh release view v1.0.0 && git ls-remote --tags origin   # only v1.0.0
```

**Final checks with Hudson:**
- Load whs.boring.energy on a real phone once C is deployed; emulation is not a phone.
- Confirm the Zenodo record resolves at doi.org.

## Addendum, 2026-09-16 (after execution began)

- **The release happened before A1.** Hudson published GitHub release v1.0.0
  from `cda3c35` at 18:37 UTC. Zenodo archived it as version DOI
  `10.5281/zenodo.22800997` (concept `10.5281/zenodo.22800996`), built from
  the old CITATION.cff: licence ODbL, but resource type Software and creator
  "World Hot Springs contributors". Section R's release step is therefore
  done; what remains of R is correcting that record's metadata in Zenodo's
  edit screen. A2 can proceed against the concept DOI.
- **D11 was added** above: phones get a compact key (Hudson's call).
- **The browser harness measured three more defects**, pinned in its specs:
  D12 (footer links overflow at 320px), D13 (the arrival globe is wider than
  a phone), and D11 as a pinned test rather than a product question.

## Addendum 2 — after v1.0.0 was released early (Hudson's decisions, 2026-09-16)

- v1.0.0 already exists (concept DOI `10.5281/zenodo.22800996`). Hudson
  corrects that record's type and creator in Zenodo's edit screen, and the
  GitHub release is retitled "World Hot Springs 1.0.0".
- **New final step R2: cut v1.0.1** once A1, B, C and A2 have merged. The
  data is unchanged; the documents are corrected and CITATION.cff carries the
  DOI, so the archive is right without hand edits. A small PR adds the
  `[1.0.1]` CHANGELOG entry, bumps package.json, widens the PATCH rule to
  "corrections to records or to the documents that travel with them", and
  regenerates. Then `gh release create v1.0.1` after Hudson's yes.
- LICENSE code copyright stays "World Hot Springs contributors".
- D4: a search or Near me closes the welcome and marks it seen.

## Outcome, 2026-09-17

Every track landed through a pull request: A1 #91, B #92, A2 #93, C #94, and
the 1.0.1 preparation #95. v1.0.1 was released from `bd73272` and archived as
`10.5281/zenodo.22813285` -- a Dataset by Hudson R&D under ODbL, the first
record built from `.zenodo.json`. The review rounds added D4's filter-rail
case (opening the filters also answers the greeting) and a fraction helper
that can say shares under a half. What is still open: v1.0.0's record
metadata (a hand edit on Zenodo), making `ui` a required check once its flake
rate is known, and the separately filed question of whether a fork workflow
can satisfy `gate-2 claims` by name.
