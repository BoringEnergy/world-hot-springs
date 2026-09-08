# Handoff — start here

Last updated 2026-09-05.

Read this first in a new session. It is the shortest path to being useful.

## Read this before touching anything

Three rules the hard way. Each cost a real defect.

**1. Every schema addition is TWO pull requests.** Gate 2 validates a pull
request's claims against the DEFAULT BRANCH's schema, so a PR cannot widen
`CLAIMABLE` and use the widening in one step -- otherwise a hostile PR would
add `id` to the list and claim it. Land the field first, then the claims.
This has bitten twice (minerals, `temperature.kind`) and the second time it
blocked a merge, because `gate-2 claims` is now a required check.

**2. Never compute a claimed value. When a source publishes a range, take the
UPPER bound.** Two temperature claims were retracted for being midpoints that
appeared on no page. Upper because the error is asymmetric: understating
tells someone a 75C spring is comfortable.

**3. Research with the project's own fetcher, not your own.** Use
`scripts/lib/verify-source.mjs`. Anything found with a different tool may not
be findable by the gate, and the claim will be refuted after you commit it.
Twice a hand-written grep pointed at the wrong occurrence -- a navigation link
and a distance in kilometres -- and both times the conclusion was wrong.

## What this is

An open atlas of the world's public hot springs. **6,471 springs across 129
countries**, derived from OpenStreetMap and published as a static site.

Repo: `https://github.com/BoringEnergy/world-hot-springs` (**public** --
deliberately; a fork exists at HudsonR-D/world-hot-springs and going private
would split it off still public, plus private repos draw from a 2,000
min/month Actions pool while public is unlimited).

**Live at https://whs.boring.energy.** A data defect is a live defect.

Platform: Windows 11, Node 24, Git Bash available. CI is `gate-1` (advisory)
and `gate-2` (the one that counts).

## Current state, 2026-09-05

**464 tests. `main` is green and everything below is merged.**

The validator is the project's centre of gravity now. A hostile agent cannot
land a fabricated NUMBER -- temperature, elevation, pH, any concentration --
because `gate-2` re-fetches the cited page from code the contributor cannot
edit and checks the value literally appears. Proven on a real fork PR.

- **Gate 2 is live and REQUIRED.** Branch protection requires
  `validate` + `gate-2 claims`. Gate 2 posts its own check run against the
  PR head via the Checks API -- a `workflow_run` workflow's own check attaches
  to main's SHA, so without that it could never be a required context.
- **No secrets anywhere.** The model layer exists and runs on demand locally
  (`--verifier vendor:model`), not in CI. All three key prerequisites are
  built and running: `assert-checkout-pristine`, content-hash fetch into a
  temp dir, and eligibility/idempotency/budget.
- **Adding a key needs two non-code things**: a durable ledger (branch
  `gate-2-ledger`, file `ledger.json`, App token scoped to just that) and a
  hard provider-side spend cap. `checkEligibility()` refuses to authorise
  spending without a ledger, so a key added now fails closed.
- **Budget is counted in CLAIMS, not reviews** -- one PR can carry 650
  claims. Caps: 100/day total, 30/day per author, 25 per review, sized for
  $9/month.

## Verdicts, and what they mean

  verified        a regex found the number in the page. Trustworthy.
  model-cleared   a reader did not refute it. WEAKER -- the page is
                  contributor-chosen, so injection cannot get past this.
  disputed        a reader disagrees. Routes to a human; never auto-rejects,
                  because the model has been wrong about a true claim twice.
  refuted         contradicted by its own source. Blocks.
  unreachable     could not be read. Blocks (an attacker can take their own
                  source offline), but retried 3x first.
  needs a reader  our enums and prose. 22 of 29 claims. NOT verified.

## Current state

- **Phase 1 complete and merged to `main`.** The atlas is no longer purely
  derived: authored corrections now survive a re-ingest.
- **Phase 2 complete.** A pull request from a stranger is safe to review by
  hand: a path guard, a deterministic validator, and a Gate 1 workflow. No
  secret exists in the repository yet, which is why nothing here can leak one.
  **All three repository settings are applied and verified**, and `gate-1` is
  proven by two real pull requests — see below.
- **Phase 3 built and running, but it has never produced a claim.** Tasks 0–11
  are done: selection, deterministic source verification, the refutation log,
  the coverage map, the provider interface, the CLI, and four providers behind
  Vercel AI Gateway on short-lived OIDC. It spends, records, caps, and resumes
  correctly. **The proposer has no retrieval**, so it is asked to cite a URL it
  has no way to look up and correctly returns nothing. **Task 12** fixes that;
  until it lands, `npm run enrich` costs money and yields zero overlay files.
- **325 tests**, `npm test`. All passing. Worth remembering that 242 of them
  passed while the enrichment pipeline could not do its job at all, and 320
  passed over a UI where clicking a search result blanked the page.
- **Build is byte-reproducible.** Two runs from identical inputs produce
  identical output; verified with `cmp`.
- The app runs: `npm run dev` (port 5177 via `.claude/launch.json`).

```bash
npm test && npm run data:build && npx tsc -b --force && npm run build
```

That is the full green-path check. The build prints its counts; expect
`merged 1167 duplicate record(s) -> 6471 springs`.

## The three documents that matter

1. **[SPEC.md](../../SPEC.md)** — the original product spec. Privacy stance is
   non-negotiable and is the reason several things are harder than they look.
2. **[specs/2026-08-25-agent-contribution-system-design.md](specs/2026-08-25-agent-contribution-system-design.md)**
   — the phase 2–5 architecture. Decisions D1–D9 with rationale; do not
   re-litigate them without reading why.
3. **[specs/2026-08-25-gate-2-trigger-security.md](specs/2026-08-25-gate-2-trigger-security.md)**
   — threat model for the CI trigger. **Read before touching `.github/`.**
   Adversarial review of its first draft found a path to the API key.

Plans live in [plans/](plans/). Phases 1, 2 and 3 are written and executed;
phase 3 runs end to end. Tasks 13-14 and the research-review integration are
the open work; no phase 4 plan exists.

## Pipeline shape

```
fetch → normalize → bad-import quarantine → dedupe
      → durable identity → curated overlay → privacy filter → output
```

**The privacy filter is last and a test asserts it.** Nothing that can add,
move, or reintroduce a record may run below it. `mergeInto()` relocates records
by up to 300 m, so ordering here is a correctness property, not style.

| Path | What it holds |
|---|---|
| `data/raw/` | Upstream snapshot. Gitignored, refetchable. |
| `data/registry.json` | Durable `whs_` ids ↔ OSM refs. Committed. |
| `data/overlay/` | **Authored claims. The only irreplaceable layer.** |
| `data/events.jsonl` | Append-only decision log. |
| `data/private/` | Exclusion list. Gitignored, never published, never logged. |
| `data/hot-springs.*` | Derived output. Committed as an artifact. |
| `data/flagship.json` | Enrichment work list. 129 countries, 492 ordered candidates. Committed. |
| `data/coverage.json` | Where public sources could not be found. Written by a run; does not exist yet. |
| `data/refutations.jsonl` | Append-only record of every claim that did *not* become a file. Written by a run; does not exist yet. |

## Fixed: selecting a spring blanked the app in a narrow viewport

Found and fixed 2026-09-03 while trying to photograph the safety banner.
Selecting any search result below 1024px wide unmounted the whole React tree
and left a white page, with `Cannot read properties of undefined (reading
'top')` from inside react-dom.

The cause was one line in `MapView.tsx`:

```js
padding: window.innerWidth >= 1024 ? { right: 420, ... } : undefined,
```

**An explicit `undefined` is not the same as an absent key.** MapLibre reads
`.top` off the value when `padding` is present, so below 1024px every
selection threw. Fixed by spreading the key in only when it is wanted.

Two things worth keeping from how this was found. It was **pre-existing** --
reproduced identically on the parent commit in a separate worktree before
blaming the safety work. And it was only ever noticed because someone tried to
*look at* the feature they had just shipped: 320 tests passed over a UI where
clicking a result blanked the screen, because `npm test` runs only
`scripts/**/*.test.mjs` and nothing exercises React at all.

`scripts/mapview.test.mjs` now guards it, in the source-scan style of
`build.test.mjs`. That is a tripwire, not a substitute for the frontend tests
the research review asks for.

## NCEI is a second upstream, and stage two is the interesting half

Landed 2026-09-07. `data/reference/ncei-thermal-springs.tsv` is a committed
mirror of NOAA's Thermal Springs List (1981, CC0, doi:10.25921/c8p0-zs06),
pinned by sha256 and rebuilt with `npm run data:ncei` -- maintainer-run, never
part of `data:build`, because the source was decommissioned in May 2025 and a
frozen dataset must not be a live dependency. Design and plan are in
`specs/2026-09-06-ncei-upstream-design.md` and
`plans/2026-09-07-ncei-upstream-stage-one.md`.

It fills temperatures on springs the atlas ALREADY HAS: 119 of them, coverage
168 -> 287. The stage sits above the privacy filter and before the overlay,
and both placements are asserted by tests rather than assumed.

**The unmatched rows are the real prize, and they are genuinely missing.**
1,506 of 1,659 rows match nothing, at a median of 43 km from the nearest atlas
record; only 109 are within 1 km. That is not coordinate drift between two
gazetteers, it is 1,500 American springs the atlas does not contain. Adding
them is stage two and needs three decisions first: whether a fumarole, steam
vent or mud pot belongs in an atlas of PUBLIC hot springs; what to do about
Yellowstone, where NOAA lists named groups and OSM lists individual vents; and
how records that exist in no other source earn a place. `data/ncei-match-report.json`
is written by every build and is the input to all three.

## ~~Known inconsistency: the claim path forbids midpoints~~ — SETTLED

Settled 2026-09-07: **an OSM range now takes its upper bound**, the same
convention rule 2 imposes on an authored claim. `parseTemperature()` used to
store the midpoint, so the atlas published computed temperatures that no source
states, reached by a route contributors are forbidden. Found because it was the
only conflict NCEI surfaced.

12 records moved, every one upward, median +1.5C. The largest is the spring
that exposed it: an unnamed Oregon spring tagged `64-92` published 78C and now
publishes 92C. Others: Einireykir 90 -> 100 (`80-100`), Hveravellir 40 -> 50
(`30-50`), Sundlaug Suoureyrar 38 -> 41 (`35-41`).

Upper because the error is asymmetric, which is the whole argument: understating
tells someone a 92C spring is a comfortable 78C. Coverage is unchanged -- these
records always had a temperature, it was the wrong one.

`Math.max`, not `vals[1]`: nothing obliges a source to write the low end first,
and a test pins it. The separator canonicaliser still distinguishes a range from
a negative reading, so `-40` remains rejected rather than becoming +40.

## Turkey needed a different method, and it changes the bar for sources

2026-09-08. **All 76 Turkish springs cite OpenStreetMap and nothing else** --
no Wikipedia, no Wikidata, no operator sites. The loop that worked for Japan,
Iceland and Russia ("fetch what the record already cites, look for a figure")
has literally nothing to fetch. Zero candidates.

So Turkey was done by SEARCHING for a source and then verifying it with
`scripts/lib/verify-source.mjs`, rather than by reading a cited one. That is
what a human contributor does and it is legitimate, but it moves who chooses
the source from OpenStreetMap to us, and that raises the bar:

**When the record already cites a source, read it. When you choose the source
yourself, a weaker one is no longer defensible.** guidetoiceland.is and
idilesom.com were fine in Iceland and Russia because the atlas already pointed
there. In Turkey, with a free choice, three claims came from Turkish
government sites (a provincial governorship, a second governorship, a district
municipality) and Karahayit was DISCARDED at 58C because the only fetchable
sources were a commercial spa directory and a newspaper. Same figure, weaker
provenance, and no reason to accept it when the rest of the batch is official.

Turkish government pages are a good seam: `*.gov.tr` and `*.bel.tr` publish
`su sicakligi` figures, and agri.gov.tr even cites its academic reference.
Note `sivas.gov.tr/sicak-cermik` is http-only and returns `source-malformed`;
the https host serves the same page.

Also worth knowing: Cermik's municipality writes 48 degrees as `48 0C` -- a
zero, not a degree sign. `valueAppears(48, ...)` is unaffected, but a scan
that reads the character after the number will mis-parse it.

**Do not re-research** Balikli Kaplica (whs_f424eaa424ff) without settling
which spring it is. Sivas has both a Kangal Balikli Kaplica and a Kalkim
Balikli Kaplica; the Kalkim page publishes 28.0-28.6C and the Kangal page no
figure at all, and the record's coordinates do not clearly pick one. Attaching
the wrong one is the Verhne-Paratunskiye mistake again.

## Things that will bite you

- **A bounding box is not a shape, and three countries cross the
  antimeridian.** Fixed 2026-09-05. `countries.mjs` fell back to the nearest
  country by distance to its BBOX, and the United States' box runs lng -178.2
  to 179.8 (the Aleutians) by lat 19.0 to 71.4. That box is zero distance from
  every northern coastal point on Earth, so 195 springs in Iceland, Italy,
  Greece, Algeria, China and the Canaries were published as American; New
  Zealand and Kiribati did the same to a further 7. Russia and Fiji have the
  same global box and were only saved by feature order. 207 records corrected.
  The index is now per-polygon, so each carries a tight box, and the fallback
  ranks by true point-to-boundary distance. **The general lesson: any
  prefilter that is also used as a ranking is a bug waiting for a shape that
  does not fit its box.**
- **Country attribution feeds the quarantine, so a country bug is a data
  bug.** `data/known-bad-imports.json` keys its rules by country, so the four
  Libyan coastal records above escaped `ly-kufra-wells` for as long as they
  were labelled US -- among them a radiology clinic and a road, tagged
  `natural=hot_spring`. Fixing the country dropped them into
  `data/suspect.json`, which is why the published count fell 6,471 -> 6,467.
  A change to `countries.mjs` is never only cosmetic; diff the record set.
- **Natural Earth 50m omits small islands.** Ten springs in the Tokara and
  Izu chains are more than the 0.5 degree (~55 km) tolerance from any
  digitised coastline, so they resolve to `XX` / Unknown. They are really in
  Japan. Unknown is honest and better than the wrong country they had before,
  but do not read a `XX` as "not a real place". Raising the tolerance to
  reach them would start attributing genuinely offshore points to whatever
  land is vaguely nearby; the real fix is a 10m boundary set.
- **Mocked providers cannot tell you the pipeline works.** 242 tests passed
  against stub providers while the proposer was architecturally unable to
  produce a claim. Stubs verify the plumbing between components; they say
  nothing about whether the component at the edge can do its job. Make the
  first real call early — it is a test nothing else replaces.
- **A wrong reason in `data/refutations.jsonl` is permanent.** `alreadyAttempted`
  skips any spring already recorded, so a run that failed for a *configuration*
  reason writes "no sources exist" and that spring is never retried without
  `--retry-refuted`. The first Iceland run recorded three such lines — including
  one claiming the Secret Lagoon has no findable sources — and the log was
  deleted rather than committed. Check *why* a run produced nothing before you
  let its log stand.
- **The config vendor id is the provider filename.** `xai:grok-4.6` loads
  `providers/xai.mjs`; the gateway prefix inside that file is `spacexai/`,
  which is a different string for a different purpose. Writing
  `spacexai:grok-4.6` in the config fails instantly with a module-not-found.
- **Free-tier gateway requests are rate-limited per model**, returning HTTP 429
  with an upgrade link. There is no retry in `gateway.mjs` yet, so a long run
  will abort partway.
- **Reasoning models bill for thinking.** One grok-4.6 proposal returned 13
  characters of content and cost $0.0089 — 1,345 of its 1,350 output tokens
  were reasoning. Any cost estimate built on visible output length is wrong and
  low. Across 492 candidates that is a 3.7x spread between the same vendor's
  reasoning and non-reasoning models: $7.26 versus $1.96.
- **`valueAppears` rejects the top of a range.** `valueAppears(40, "38-40
  Celsius")` is `false`, because `-` was added to the lookbehind so a page
  reading `-40 °C` could not certify `40`. The trade was made deliberately on
  the assumption that ranges were rare; hot spring temperatures are published
  as ranges more often than not, so half of every range is unverifiable.
  Task 12 fixes it. The `-40` case must keep passing.
- **The Vercel free tier restricts which models you may call, and the API will
  not tell you which.** `/v1/models` lists 364 models with no tier or access
  field; `anthropic/*` returns 403 `no_providers_available` and `google/*`
  returns 403 `byok_requires_paid_credits`, discoverable only by calling them.
  Combined with the proposer/verifier distinctness rule this leaves exactly one
  usable vendor pair on the free tier: **openai + xai**. The free-tier rate
  window is also long — six retries across five minutes did not clear it, and
  diagnostic probing competes with real runs for the same quota.
- **A verifier can return a reason that contradicts its own verdict.** A real
  run produced `refuted-by-verifier` whose note argued the claim was correct.
  `verdict?.refuted !== false` treats anything not exactly `false` as a refusal,
  which is the right default — but a malformed verdict is not a refutation, and
  recording it as one writes a false fact into a permanent log.
- **The fetch-check answers "does this number appear", not "does this page say
  this".** `valueAppears(39, ...)` returned true against a page whose only 39
  was inside `WhatsApp +354 777 39 35`. The verifier is what catches that, and
  it is why dropping the verifier to save money would be a false economy.

- **Durable ids are 12 hex characters, not 6.** Six produced two real collisions
  across the dataset's 7,638 OSM refs. Two springs sharing an id means claims
  attaching to the wrong spring, silently and permanently.
- **An empty exclusion list makes the privacy filter a no-op.** Every test can
  pass against a filter that is broken. Exercise it with a temporary list in
  `data/private/exclusions.json` before trusting a change to it. Delete it after.
- **`git add -A` while a subagent is editing** sweeps its work into your commit.
  Stage explicit paths.
- **`git checkout <file>` will not revert an untracked file.** Mutation-testing a
  new module needs a manual restore.
- **The dedupe pass is greedy and order-dependent.** A static pairwise scan over
  the *published* dataset cannot predict what it will do, because the records
  that merged are the ones missing from that file. Measure against pre-dedupe
  records.
- **Do not put anything derived from the exclusion list in a public artifact.**
  Geohash space is small enough to enumerate offline.
- **`Number.isFinite(Infinity)` is `false`.** A `--limit` guard defaulting to
  `Infinity` and validating with `Number.isFinite` rejects every run that omits
  `--limit` — that is, every real run. Guard the parsed argument, not the
  default.
- **A guard that is unit-tested is not a guard that runs.** One was written,
  tested, and never wired into `enrich.mjs`, which is the code CI executes. Ask
  what calls it, not whether it has a test.
- **`data/coverage.json` and `data/refutations.jsonl` are run outputs, not
  fixtures.** Neither exists until an enrichment run writes it, so a test that
  reads them from the repo passes on absence. `pathguard.mjs` already lists
  both in `ALLOWED_FILES` in anticipation.

## Where the bodies are buried

Phase 1 found five defects. **Every one was in the plan, not the
implementation.** Worth knowing because it says where to be suspicious:

| Defect | Would have caused |
|---|---|
| 6-hex durable ids | Two springs sharing an identity, permanently |
| Privacy filter not actually last | A merge relocating a record past the exclusion check |
| Substring name rule unexamined | `"No. 4"` merging with `"No. 4b"`, 62 m apart |
| Character-count fix for that | Four genuine CJK/Arabic duplicates 2–7 m apart un-merged |
| Test fixture 55.6 m apart asserting no-match | Loosening a real 60 m threshold to satisfy a wrong test |

The lesson that generalises: **thresholds and hash lengths in a plan are
assertions, not decisions.** Measure them against the real dataset before
implementing.

## Recorded follow-ups

- ~~Registry fallback is O(n²)~~ — **done**, bounded with a spatial index.
  44 ms cold bootstrap, 101 ms worst case, verified behaviour-identical.
- ~~Gate 2 trigger security~~ — **done**, hardened design written and
  adversarially reviewed. Implementation is **phase 4**; phase 3 became
  flagship enrichment instead. Still blocked on F8 and F9.
- `asComparable()` picks `osmRefs[0]`, which sorts `node` before `way`. Only
  affects the one-named-one-unnamed branch for refs that did not already match
  directly. Minor; noted, not fixed.

## Repository settings — applied and verified 2026-08-28

All three are done. Each was verified by reading the API back, not by trusting
the settings UI, because two of them silently did not apply the first time.

| Setting | State | Verified |
|---|---|---|
| Fork PR workflows → require approval for **all** external contributors | `approval_policy: all_external_contributors` | 2026-08-28 |
| "Allow GitHub Actions reviews to count towards required approval" **off** | `can_approve_pull_request_reviews: false` | 2026-08-28 |
| Branch protection on `main` | `validate` check required, strict, 1 review, stale reviews dismissed, no force-push, no deletion | 2026-08-28 |

Re-verify all three at any time:

```bash
R=repos/BoringEnergy/world-hot-springs
gh api $R/actions/permissions/fork-pr-contributor-approval
gh api $R/actions/permissions/workflow
gh api $R/branches/main/protection
```

**`enforce_admins` is deliberately `false`.** GitHub does not let anyone
approve their own pull request, so with a single maintainer, `enforce_admins:
true` plus a required review is a lock with the key inside — no change could
ever merge. Admins bypass; outside contributors do not, which is the boundary
that was wanted. Turn it on the day a second maintainer exists.

### What was actually wrong before

Worth recording, because the settings UI reported success for two things that
had not happened:

- **Fork PR approval could not be set at all while the repo was private.** The
  API rejects it outright: *"Fork PR approval is not allowed for private
  repositories."* The toggle appeared to work and applied to nothing.
- **Branch protection was never a plan-tier problem the way it looked.** The
  blocker was private-repo-on-free, not personal-versus-org. A free
  *organization* does not get protected branches on private repos either, so
  moving the repo without also publishing it would have changed nothing.

Both unblocked the moment the repository went public, which it needed to be
regardless — see below.

## The repository is public, and had to be

`https://github.com/BoringEnergy/world-hot-springs` — public since 2026-08-28,
transferred from `HudsonR-D/` the same day. The old URL redirects.

This was not cosmetic. **Nobody can fork or open a pull request against a
private repository.** Every gate phase 2 built was guarding a door with no
entrance: at the moment of publication `forks: 0` and `gate-1` had been
registered and active for hours without ever running once.

**Git history was rewritten on 2026-08-28**, before publication, to replace a
personal email in all 34 commits with a GitHub noreply address. Content was
unchanged — the tree hash of `main` is identical before and after
(`1a2e9804…`) and the commit count is the same. Any clone predating that day
has incompatible history and must be re-cloned rather than pulled.

Everything in the Gate 2 security note assumes an uncompromised default branch.
Branch protection is now what holds that assumption up.

### `gate-1` is proven, not just configured — 2026-08-28

Two throwaway PRs, since a workflow that has never run is a hypothesis:

| PR | Change | Result |
|---|---|---|
| #1 | one file in `data/overlay/` | `validate` **SUCCESS** — `1 file(s) checked, 0 with problems.` |
| #2 | one file in `scripts/lib/` | `validate` **FAILURE** — `scripts/lib/pathguard.mjs: a contribution may only modify data/overlay/**` |

The failure message was checked, not just the red X. A gate that fails for an
incidental reason looks identical to one that works, and that mistake has
already been made once in this repo — see the traversal test in the phase 2
defect table.

Both PRs are closed and their branches deleted.

`sha_pinning_required: true` was also applied on 2026-08-28.
`scripts/workflows.test.mjs` enforces SHA pinning on a laptop, which a fork
simply skips; this enforces it at the platform.

## What phase 2 built

| File | What it does |
|---|---|
| `scripts/lib/pathguard.mjs` | Which paths an outside PR may modify. Pure, normalises before checking. |
| `scripts/validate-overlay.mjs` | `npm run validate`. Same code on a laptop and in CI. |
| `.github/workflows/gate.yml` | Gate 1. No secrets, no `npm ci`, actions pinned to SHAs. |
| `scripts/pathguard.test.mjs`, `scripts/workflows.test.mjs` | The guards, mutation-checked. |

**Gate 1 is not a security boundary and the workflow says so in its header.**
On a fork PR the workflow file comes from the PR head, so a contributor can
rewrite it to report success on anything. Phase 4's Gate 2 re-runs it from
default-branch code; that is the check that counts.

### Phase 2's defects were also all in the plan

The phase 1 lesson repeated exactly. Four found, none in the implementation:

| Defect | Would have caused |
|---|---|
| Traversal test asserted only *that* a path was rejected | Passed with the normaliser deleted — the literal `..` tripped the unrelated "no subdirectories" branch |
| Repo guards scanned raw YAML | `gate.yml`'s own comments ("No secrets. No `npm ci`") failed the guards; the fix on offer was deleting the explanation |
| Comment stripper used `.*$` | `\r` is a regex line terminator, so on a CRLF checkout nothing stripped and all four guards silently scanned prose |
| Validator read deleted files | A legitimate removal request reported as "not valid JSON" |

The CRLF one is the one to remember: it was caught **only** because a mutation
run passed when it should have failed. A guard that quietly stops guarding
looks exactly like a guard that is working.

### Phase 3 made it four phases in a row

Eleven tasks, and **every defect found was in the plan, not the
implementation.** The new shape is what to take forward: **ten separate tests
were caught passing for the wrong reason.** A test that passes is evidence
about the test until you have watched it fail.

| Defect | Would have caused |
|---|---|
| Candidate test asserted only a length | "Select the worst five candidates" passing the whole suite |
| Test sorted its own result before comparing | A reversed sort certified as correct |
| Guard unit-tested but never wired into `enrich.mjs` | A guard proven on a laptop and absent from the run CI executes |
| Mutation check killed four tests, not the one it named | An assertion certified without ever being exercised |
| `Number.isFinite(Infinity)` in the `--limit` guard | Every run that omitted `--limit` rejected |

The generalisation on top of phase 1's: **a plan's tests are assertions too.**
Mutate the code each one names and confirm that specific test is the one that
dies.

## What phase 3 built — and why it cannot run yet

Phase 3 was **not** Gate 2. Gate 2 stayed blocked on F8 and F9 (below), so the
phase was re-scoped to producing the atlas's first authored claims from a
script the operator runs **locally on their own credential**. That is why
`scripts/workflows.test.mjs`'s "no workflow references a secret" test still
passes unchanged: no secret entered the repository, no maintainer carries the
spend, and there is no CI trigger to secure.

| File | What it does |
|---|---|
| `scripts/lib/flagship.mjs` | Picks the springs worth enriching. Two per country, over-provisioned to five ordered candidates. |
| `scripts/lib/verify-source.mjs` | Deterministic fetch-check: retrieves the cited page, byte-capped, and looks for the value. No model involved. |
| `scripts/lib/refutations.mjs` | Appends to `data/refutations.jsonl`. Closed 10-member outcome enum; an unknown outcome throws. |
| `scripts/lib/coverage.mjs` | Builds `data/coverage.json`. Tracks `verified` and `alreadyHad` separately, on purpose. |
| `scripts/lib/providers/index.mjs` | Provider interface, plus the one hard rule: proposer and verifier must be different **vendors**. |
| `scripts/enrich.mjs` | The CLI. `npm run enrich`, `npm run enrich:plan` (dry run). |

Two design points worth not re-litigating:

- **The proposer and the verifier must come from different vendors**, enforced
  in `resolveRoles`. Two models from one vendor share training data and failure
  modes, so one refuting the other is nearly as circular as self-review. This
  is also why N-way agreement was rejected — correlated error is not evidence.
- **`coverage.json` counts `verified` and `alreadyHad` apart.** Folding a
  pre-existing human overlay into `verified` would let a resumed run that made
  no calls report a country as freshly proven, in the one artifact the spec
  insists must not mislead.

Agents may claim **13 of the 17** claimable fields; `AGENT_HELD_BACK` in
`scripts/lib/overlay.mjs` withholds `location.nearestTown`, `name`, `warnings`,
and `tags`. The reasoning is in CONTRIBUTING.md.

### Task 8 is the blocker: there is no vendor module

`loadProviders` imports `./<vendor>.mjs`, and **`scripts/lib/providers/` holds
`index.mjs` and nothing else.** Every other piece is built and tested, but the
pipeline cannot make a single model call — a real run fails at the dynamic
import. `enrichment.config.example.json` names `openai:gpt-5` and
`anthropic:claude-opus-5` as an illustration, not a commitment.

This is deliberate and it is not a code problem. The distinctness rule means
credentials are needed from **two different vendors**, and obtaining them is
the operator's to do. Nothing about the rest of the phase should be reworked to
avoid it: writing one vendor module is one file, and nothing else in the
codebase learns that vendor's name.

Until then `npm run enrich:plan` is the only useful invocation — it plans
without calling anything — and neither `data/coverage.json` nor
`data/refutations.jsonl` exists.

## Next: phase 4 — Gate 2, still blocked

**Do not begin until
[specs/2026-08-25-gate-2-trigger-security.md](specs/2026-08-25-gate-2-trigger-security.md)
has been read in full.** Its first draft contained a path to the API key. Read
2026-08-28; the summary below is not a substitute for reading it.

Phase 4 introduces the first secret in the repository, so
`scripts/workflows.test.mjs`'s "no workflow references a secret" test must be
deliberately changed. That is the point of it: the change is a decision
someone makes on purpose, not a thing that drifts in.

### Three things block it, and two of them are not code

**1. No phase 4 plan exists.** `plans/` holds phases 1, 2 and 3. The security
spec is a design, not an implementation plan — it names components
(`resolve-pr.mjs`, `path-guard.mjs`, `check-eligibility.mjs`,
`fetch-overlay-diff.mjs`, `assert-checkout-pristine.mjs`, `manager.mjs`) and 14
required tests, but nothing sequences them. Given that every defect in phases
1 through 3 was in the plan rather than the implementation, writing this one
carefully is the highest-leverage hour available.

**2. F9 is not done, and the spec rates it above all the code.** A *dedicated
Anthropic workspace holding this key, with a hard monthly spend limit* set
below the pain threshold, plus rotation and spend alerting. Only the account
owner can do this. Every other control in the spec lives on the GitHub side of
the boundary; this is the one that converts "the owner's card is drained" into
"the reviewer stops working and the owner gets an email." The spec calls its
absence from the first draft the most instructive miss in the review.

**3. F8 needs an infrastructure decision.** The spend ledger cannot be a file
on `main` under `contents: read`, and the Actions cache is branch-scoped and
evicts after 7 idle days — so idling the repo resets the budget, which is a
spend attack by itself. The store must be named before anything is built:
a GitHub App token with `contents: write` scoped to one ledger file on a
protected orphan branch, or an external KV with compare-and-swap.

Already satisfied from the spec's configuration section: **F10** (fork PR
approval for all external contributors) and the Actions-review-approval
toggle. Both verified above.

## ~~Known defect: `gate-1` fails every maintainer pull request~~ — FIXED

**This section was stale and cost a wrong prediction on 2026-09-05**, when a
maintainer PR touching `scripts/lib/` was announced as certain to fail
`validate` and then passed. Verify a "known defect" against a live run before
repeating it; a defect list is a claim about the present, not a diary.

The described fix is already implemented. `gate.yml` passes
`IS_FORK_PR: ${{ github.event.pull_request.head.repo.fork }}`, and
`validate-overlay.mjs:78` applies `checkPaths` only when that is `"true"`. A
same-repo PR logs *"Same-repo change: validating overlay files, path guard
not applied"* and passes. The job still runs on every PR, which is what
matters: a required check that gets *skipped* sits pending forever and blocks
a merge just as hard as a failing one.

For the record, the original defect: the path guard exists to constrain
strangers, but it was applied to every pull request, so any maintainer PR
touching `scripts/`, `src/`, `docs/`, or `package.json` failed a **required**
check. It was never a security weakness — an overlay-only contribution passed
normally, and a failed gate-1 means `workflow_run` never fires, so no spend
occurs.


---

## Next up, 2026-09-05: seeding

The apparatus is done. What remains is filling the atlas, and it is
repetitive rather than architectural.

**Coverage: temperature 168 of 6,471 (3%)**, up from 95 on 2026-09-05.
That number is the whole point the project makes about the state of public
hot-spring data, so moving it is the work. 73 claims landed in one pass, in
eight batches; the rate limit was research, never the apparatus.

### The United States is blocked on a schema field

2,025 springs, 15 with a temperature after this pass. It is the largest gap
in the atlas and the cheapest to close -- **except that American sources
publish Fahrenheit.**

Colorado was surveyed end to end: 40 springs, 2 with a temperature, 10 with
an operator website. Not one publishes Celsius. Iron Mountain Hot Springs
states `89°-108°F` for its pools, which is a good, specific, verifiable
figure -- and unclaimable, because `temperature.celsius` is the only
claimable temperature field and converting 108F to 42C is computing a
claimed value, which rule 2 forbids.

Where American springs DID yield was English Wikipedia, which prints both:
`Temperature 94 °C (201 °F)`. That is 7 claims from 11 articles. It does not
scale -- only 11 of 2,025 US springs cite Wikipedia at all.

**The fix is `temperature.fahrenheit` in CLAIMABLE, and it is two pull
requests** (see rule 1). It would open the operator-website seam for the
whole country. Not done here because no batch was blocked in a way that
justified deciding it alone; raise it before the next US pass.

### The loop that works

1. `data/flagship.json` holds ranked candidates per country. Records already
   carry official websites and Wikipedia URLs in `sources[]` -- no searching
   needed for most.
2. Fetch those with `scripts/lib/verify-source.mjs` and look for figures.
   A scratch helper doing this is worth rebuilding; do NOT grep by hand.
3. Write the overlay file, `node scripts/validate-overlay.mjs`, then
   `node scripts/verify-claims.mjs --files <path>` BEFORE committing.
4. Rebuild, run the suite, open a PR. Gate 2 re-verifies from trusted code.

**Yield is about 50% on Western sources, near 70% on Japanese ones.** Of 11
springs researched in the first pass, 5 published a findable figure; of 48
Japanese articles checked, 28 carried one. Expect to discard, and prefer discarding to reaching
for a weaker source.

### Japanese Wikipedia is the largest single unlock

`ja.wikipedia.org` onsen articles carry a standard infobox field,
`泉温（摂氏）`, holding the SOURCE temperature. It is uniform enough to
extract with one regex:

```js
r.text.match(/泉温（\s*摂氏\s*）\s*([^宿湧p液テ]{1,40})/)
```

Japan is ~950 springs, 15% of the atlas. 66 of them cited a `ja.wikipedia`
article and had no temperature. **All 66 are now checked: 38 carried the
field, 28 did not.** That is a 58% yield with no searching and no judgement
call per spring -- read one field, take it.

The handoff's ASCII-only warning about `valueAppears` did NOT bite: these
articles write half-width digits, and every one of the twenty verified on the
first pass. The warning still stands for pages using full-width or CJK
numerals — it simply is not what Wikipedia does.

**All thirty-eight are claimed. This seam is exhausted** -- do not re-run it
hoping for more. Going further into Japan needs a source other than the
`sources[]` already on the record: only 66 of ~950 Japanese springs ever
carried a Wikipedia link, and every one has now been read.

The 28 that carried no `泉温` field are mostly bath-house articles rather
than spring articles (金の湯, 銀の湯, 竹瓦温泉, 片倉館) -- the building has
an article, the water does not. A different source type, not a second pass.

### Two traps this pass hit

**Run `data:build` BEFORE `npm test`, not after.** `scripts/docs.test.mjs`
asserts the README coverage table against `data/summary.json`. Testing first
reads the pre-build summary and passes over a README that the batch has just
made wrong. The first batch of this pass shipped a stale `1%` that way and
needed a follow-up commit.

**Batches conflict with each other through the derived files.** Every batch
rewrites `data/hot-springs.json`, `.geojson` and `summary.json`, so two
branches cut from the same `main` cannot both merge cleanly. Either land each
batch before starting the next, or stack the branches — which is what
2026-09-05 did, PRs #37 -> #38 -> #39 -> #40, each based on the one before.

### Known-unclaimable, checked and rejected

Friedrichsbad, Therme Wien, Craters of the Moon, Termas do Geres, Anna Furdo
publish no temperature this verifier can find. Do not re-research them
without a new source.

Added 2026-09-05, no figure on the cited page: Zelena zaba, Klevevz, Le
Caldane, Poca da Dona Beija, Ecotermales, Thermae Bath Spa, Fortyseven
Baden, Claudius Therme, Silvretta Therme, Balneario de Aguas de Lindoia,
Therma Gera, Heisse Brunnen Ennetbaden, Felsentherme Bad Gastein, Terme
Borrini, Terme dell'Osa, Complesso termale di Agnano, Thermes de
Pre-Saint-Didier, Laugaras Lagoon, Banos Termales Maya, Manupirua Springs,
El Safareig.

Rejected for a stated reason, which is different — a figure exists but is
not claimable:

  Aqua Dome            the page contradicts itself: 68C from the 1997 bore,
                       then 40C "aus einer Tiefe von 1.865 Metern" into the
                       pools. Same depth, two numbers.
  Hagymatikum          41C is the 1956 well, under "A furdo hoskora", with
                       no stated link to today's supply
  Skolska cesma        "17°-19 °C". The dash before 19 has a non-digit
                       before it, so valueAppears reads it as a SIGN and the
                       upper bound cannot verify. The lower bound is not
                       ours to take. This is the one range shape the
                       upper-bound convention cannot rescue.
  Eurotherme Bad
  Schallerbach         34C is one hotel wellness pool, not the baths
  Kristalltherme
  Altenau              36C is a 12% brine tub, not the thermal water
  Termas da
  Chavasqueira         43-63C describes Ourense's free pools broadly
  Terme della
  Ficoncella           "circa 60 gradi in uscita e 40 nelle vasche" -- circa
                       governs both, and the record has no name
  Szarvasi gyogyfurdo  http-only; the fetcher returns source-malformed, and
                       it is worth checking whether an https host exists

### Open ideas, none blocking

- `location.accuracyMeters`, per-source licences, `facilities[]`, photo
  rendering -- from the deep-research review, still unbuilt.
- Frontend tests. There is no React harness; UI invariants are pinned by
  source-scan guards in `scripts/*.test.mjs`, which is a real gap.
- `enforce_admins: false` means the maintainer can bypass every gate with
  `--admin`. Right for a solo project, worth knowing.
- The 22 prose claims that "need a reader" stay unverified until the model
  layer runs in CI, which needs the ledger and cap above.
