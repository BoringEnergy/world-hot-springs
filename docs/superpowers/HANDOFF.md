# Handoff — start here

Last updated 2026-08-25, end of phase 2.

Read this first in a new session. It is the shortest path to being useful.

## What this is

An open atlas of the world's public hot springs. **6,471 springs across 129
countries**, derived from OpenStreetMap and published as a static site.

Repo: `https://github.com/HudsonR-D/world-hot-springs` (private).
Platform: Windows 11, Node 24, Git Bash available. No CI configured yet.

## Current state

- **Phase 1 complete and merged to `main`.** The atlas is no longer purely
  derived: authored corrections now survive a re-ingest.
- **Phase 2 complete.** A pull request from a stranger is safe to review by
  hand: a path guard, a deterministic validator, and a Gate 1 workflow. No
  secret exists in the repository yet, which is why nothing here can leak one.
  **Three repository settings are still outstanding — see below.**
- **128 tests**, `npm test`. All passing.
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

Plans live in [plans/](plans/). Phase 1's is complete; phase 2's is ready.

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

## Things that will bite you

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
  adversarially reviewed. Implementation is phase 3.
- `asComparable()` picks `osmRefs[0]`, which sorts `node` before `way`. Only
  affects the one-named-one-unnamed branch for refs that did not already match
  directly. Minor; noted, not fixed.

## Outstanding: three repository settings

Phase 2's code is done. These are GitHub settings, cannot be committed, and two
of them matter more than anything in the code. **They are not applied.** Record
the date beside each when it is, because "we meant to" is indistinguishable
from "we did" six months later.

| Setting | Applied |
|---|---|
| Actions → Fork PR workflows → **Require approval for all external contributors** (the default covers only first-time contributors, which is exactly the population that costs nothing) | not yet |
| Org-level: **disable** "Allow GitHub Actions reviews to count towards required approval" (on by default; lets a workflow token satisfy branch protection) | not yet |
| Branch protection on `main`: require the `gate-1` check, require review, disallow force-push | not yet |

Everything in the Gate 2 security note assumes an uncompromised default branch.
Until the third row is done, that assumption is not held up by anything.

## What phase 2 built

| File | What it does |
|---|---|
| `scripts/lib/pathguard.mjs` | Which paths an outside PR may modify. Pure, normalises before checking. |
| `scripts/validate-overlay.mjs` | `npm run validate`. Same code on a laptop and in CI. |
| `.github/workflows/gate.yml` | Gate 1. No secrets, no `npm ci`, actions pinned to SHAs. |
| `scripts/pathguard.test.mjs`, `scripts/workflows.test.mjs` | The guards, mutation-checked. |

**Gate 1 is not a security boundary and the workflow says so in its header.**
On a fork PR the workflow file comes from the PR head, so a contributor can
rewrite it to report success on anything. Phase 3's Gate 2 re-runs it from
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

## Next: phase 3

**Do not begin until
[specs/2026-08-25-gate-2-trigger-security.md](specs/2026-08-25-gate-2-trigger-security.md)
has been read in full.** Its first draft contained a path to the API key.

Phase 3 introduces the first secret in the repository, so
`scripts/workflows.test.mjs`'s "no workflow references a secret" test must be
deliberately changed. That is the point of it: the change is a decision
someone makes on purpose, not a thing that drifts in.
