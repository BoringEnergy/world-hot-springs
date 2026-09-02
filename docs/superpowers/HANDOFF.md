# Handoff — start here

Last updated 2026-08-30, end of phase 3.

Read this first in a new session. It is the shortest path to being useful.

## What this is

An open atlas of the world's public hot springs. **6,471 springs across 129
countries**, derived from OpenStreetMap and published as a static site.

Repo: `https://github.com/BoringEnergy/world-hot-springs` (**public**).
Platform: Windows 11, Node 24, Git Bash available. CI is `gate-1` and nothing
else; there is no deploy pipeline, so nothing is hosted anywhere yet.

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
- **242 tests**, `npm test`. All passing — and note that all 242 passed while
  the pipeline could not do its job. See the Task 12 lesson below.
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
phase 3's Task 8 is the only step left unimplemented. No phase 4 plan exists.

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

## Things that will bite you

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

## Known defect: `gate-1` fails every maintainer pull request

`validate-overlay.mjs --changed-only` applies `checkPaths` to *every* pull
request, but the path guard exists to constrain strangers. Any maintainer PR
touching `scripts/`, `src/`, `docs/`, or `package.json` therefore fails a
**required** check. Demonstrated on PR #2 above; the only reason work still
lands is `enforce_admins: false` letting an admin bypass.

This does not weaken the Gate 2 design — an overlay-only contribution passes
gate-1 normally, and a failed gate-1 simply means `workflow_run` never fires,
so no spend occurs. It is a maintainer-workflow defect, not a security one.

The fix is to enforce the path guard only on fork PRs while still running the
job on every PR. It must keep running: a required check that gets *skipped*
sits pending forever and blocks the merge just as hard as a failing one.
