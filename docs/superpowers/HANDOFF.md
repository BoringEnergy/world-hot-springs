# Handoff — start here

Last updated 2026-08-25, end of phase 1.

Read this first in a new session. It is the shortest path to being useful.

## What this is

An open atlas of the world's public hot springs. **6,471 springs across 129
countries**, derived from OpenStreetMap and published as a static site.

Repo: `https://github.com/HudsonR-D/world-hot-springs` (private).
Platform: Windows 11, Node 24, Git Bash available. No CI configured yet.

## Current state

- **Phase 1 complete and merged to `main`.** The atlas is no longer purely
  derived: authored corrections now survive a re-ingest.
- **113 tests**, `npm test`. All passing.
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

## Next: phase 2

[plans/2026-08-25-phase-2-contribution-gates.md](plans/2026-08-25-phase-2-contribution-gates.md)

Path guard, deterministic validator, and Gate 1. **No secrets, no LLM, no trust
levels** — those are phase 3, and phase 3 must not start until the security note
above has been read in full.
