# Curated overlay, agent contribution, and review pipeline

Design doc — 2026-08-25

## The problem

The atlas holds 6,470 records and is fully derived: `npm run data:build` regenerates
every record from an OpenStreetMap snapshot. There is nowhere to record that a human
knows something OSM doesn't. A correction survives exactly until the next ingest.

That is the real constraint, and it is not a scale problem. 6,470 rows is small; flat
files handle 100k comfortably. What's missing is **provenance and workflow**: a way to
assert a fact, attribute it, review it, and route disagreements to a decision. A
database would be premature infrastructure and is explicitly not proposed here.

Three things follow from fixing it: external agents get something safe to contribute
*to*, the review pipeline gets something to gate, and the self-improving loop gets
events to learn from.

## Decisions

Settled during brainstorming, recorded with rationale so they aren't silently
re-litigated later.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Hybrid review cost.** Deterministic gates run free; an LLM manager runs only on what survives, on a separate capped API key. | Any LLM review costs someone tokens. Free gates reject most junk, so spend tracks real submissions, not spam. |
| D2 | **GitHub-native substrate.** Contributions are PRs; gates are Actions; escalation is a review request. | Auth, identity, audit log, rollback, and a review UI already exist and cost nothing. Building an MCP server plus database would rebuild all of it. |
| D3 | **Upstream conflict becomes a review item.** The curated value keeps rendering; the disagreement is recorded and queued. | "Curated always wins" calcifies into stale readings. "OSM always wins" destroys contributor work. Only this option lets the dataset improve. |
| D4 | **Open contribution, trust starts at zero.** Anyone may submit; nobody gets automated review until submissions have been accepted. | Keeps the door open without letting a stranger trigger token spend. |
| D5 | **Privacy check runs in the trusted job, not public CI.** | See "Privacy gate" — publishing hashes of the exclusion list would leak it. |

## Non-goals

- No database. No hosted service. No MCP server in this phase (D2 leaves it as a
  possible thin adapter later; it is not designed here).
- No adaptive thresholds or learned scoring until there are ~100 reviewed
  submissions. Instrument now, learn later. Tuning on five data points is
  superstition with extra steps.
- No public contributor leaderboard or reputation display.
- No change to the privacy guarantee in `PRIVACY.md`. This design must strengthen it,
  never weaken it.

## Architecture

Split what is derived from what is authored.

| Layer | Contents | Committed |
|---|---|---|
| `data/raw/osm/` | Upstream snapshot | No — refetchable |
| `data/registry.json` | Durable spring ids ↔ OSM refs | Yes |
| `data/overlay/*.json` | **Authored claims. The asset.** | Yes |
| `data/contributors.json` | Trust levels | Yes |
| `data/events.jsonl` | Append-only decision log | Yes |
| `data/hot-springs.*` | Derived = ingest ⊕ overlay | Yes, as a build artifact |

The overlay is the only layer that cannot be regenerated. Everything else is cache.

### Build order

```
fetch → normalize → bad-import quarantine → dedupe
      → identity resolve → overlay merge → privacy filter → output
```

Two invariants:

1. **The privacy filter stays last.** It is the guarantee in `PRIVACY.md` and nothing
   may run after it.
2. **Identity resolution precedes overlay merge**, because claims are keyed by durable
   id, not by OSM ref.

## Identity

`osm-node-123` is stable only while that node exists. Nodes get deleted and redrawn,
and an orphaned claim is a lost correction.

Springs therefore get an id of ours. `data/registry.json`:

```json
{
  "whs_a1b2c3": {
    "osmRefs": ["node/4702109263"],
    "centroid": [-21.2222, 64.048],
    "name": "Reykjadalur",
    "firstSeen": "2026-08-25",
    "lastSeen": "2026-08-25"
  }
}
```

Resolution order on each build:

1. Match by OSM ref.
2. Fall back to `isSameSpring()` — the proximity-and-name predicate already written and
   tuned for the dedupe pass. It is promoted from `scripts/build-dataset.mjs` to
   `scripts/lib/identity.mjs` and reused unchanged, so identity and dedupe cannot drift
   apart.
3. No match → mint a new id.

Registry entries matching nothing this build are **not deleted**. They are marked
`missingSince` and emit `spring.disappeared`. A spring vanishing from OSM is a review
item, not a silent deletion — especially since one plausible cause is an upstream
privacy removal we should honour.

Ids are `whs_` + 6 chars of a hash of the first-seen OSM ref, so they are stable and
reproducible rather than sequential.

## Claims

Overlay files assert **individual fields**, never whole records. This is what makes D3
work: OSM stays free to improve fields nobody has claimed, while a claimed field is
protected and its disagreement is tracked.

`data/overlay/whs_a1b2c3.json`:

```json
{
  "id": "whs_a1b2c3",
  "claims": {
    "temperature.celsius": {
      "value": 38,
      "source": "https://example.org/survey",
      "measuredAt": "2026-03-14",
      "contributor": "github:someone",
      "state": "active",
      "approvedBy": "manager",
      "approvedAt": "2026-03-20",
      "supersedes": null
    }
  }
}
```

### Claimable fields

Allowlisted. Anything not on this list is rejected by Gate 1.

**Claimable:** `name`, `temperature.celsius`, `temperature.measuredAt`,
`temperature.source`, `access.price`, `access.currency`, `access.notes`,
`clothing.policy`, `clothing.schedule`, `clothing.notes`, `hours.open`,
`hours.seasonalNotes`, `hours.status`, `type`, `description`, `tags`, `warnings`,
`location.elevation`, `location.region`, `location.nearestTown`.

**Never claimable:** `id`, `unicorn`, `quality.*`, `verified`, `sources`,
`location.lat`, `location.lng`.

`unicorn` and `quality.*` are pipeline-owned. `verified` means a human checked a
primary source and is set by the review pipeline, not asserted by the submitter.
`sources` is not claimable as a field, but every claim carries a `source` and the merge
appends it to the record's `sources` — provenance accrues automatically rather than
being asserted.

Coordinates are excluded deliberately: moving a spring is how you would defeat the
privacy radius check, so relocation is a separate claim type requiring human review.

**Array fields merge, they do not replace.** A claim on `tags` or `warnings` adds
entries; it never removes them. Removing a derived warning would let a contributor
strip a scalding notice, so removal is a separate `retract` claim type, always human,
and never available below `trusted`.

**New springs are proposed, not claimed.** A claim requires an existing registry id, so
a new spring arrives as a `data/overlay/_proposed/<slug>.json` file carrying
coordinates, a name, and a source. It is always human-reviewed, and on acceptance the
merge mints a registry id and rewrites the file as a normal overlay entry. This keeps
Gate 1's "id must exist in the registry" rule simple and gives new springs their own,
stricter path.

### Risk tiers

Tier drives who can approve, not whether a claim is allowed.

- **Low** — `hours.*`, `access.*`, `description`, `tags`, `location.region`,
  `location.nearestTown`. Cheap to reverse, low harm if wrong.
- **High** — `temperature.*` (the scalding warnings derive from it, so a wrong value
  is a safety issue), `clothing.policy` (wrong value walks someone into a bad
  situation), `type`, `warnings`, `name`.
- **Always human** — creating a new spring, any relocation, any `retract` of a derived
  warning, anything touching a record whose registry entry is flagged.

### Claim state machine

```
proposed ──► gated ──┬─► rejected
                     └─► active ──► contested ──┬─► reaffirmed ──► active
                                                ├─► superseded ──► active (new claim)
                                                └─► retired
```

`contested` is entered by the build, not by a person: when a claim is active and the
incoming OSM value disagrees, the merge emits `claim.contested`. The claim keeps
rendering while contested, so the site never regresses.

## Overlay merge

For each spring, for each active claim: write the claimed value over the derived one,
and append the claim's `source` to `sources`.

Drift detection: if the claim is active, the incoming OSM value is non-null, and the
two disagree beyond a per-field tolerance (0.5 °C for temperature; exact for enums and
strings), emit `claim.contested`.

**Assertion:** every active claim must appear in the output or be explicitly logged as
suppressed by the privacy filter. A claim that silently vanishes is a lost correction,
so the build fails on an unexplained count mismatch.

### Determinism

The build must be reproducible, or every rebuild produces a 6 MB diff nobody can
review.

`metadata.generated` currently uses `new Date()`, which alone makes every build differ.
It changes to the OSM snapshot date (newest tile mtime), overridable by
`SOURCE_DATE_EPOCH`. CI then asserts that rebuilding from committed inputs reproduces
the committed outputs byte for byte.

## Contribution pipeline

A contributor's agent opens a PR. It burns its own tokens producing that PR; that cost
never touches this project.

### Gate 0 — path guard

An outside PR may modify `data/overlay/**` and nothing else. A PR touching `scripts/`,
`src/`, `.github/`, or the derived artifacts is closed automatically with an
explanation.

This blocks the obvious attack: a PR that edits the workflow that reviews it.

### Gate 1 — deterministic validation (free, zero tokens)

Runs on `pull_request`. No secrets, no network beyond a source `HEAD` check.

- JSON schema valid; `id` exists in the registry (or the file is under
  `_proposed/`, which routes straight to human review)
- every claim path is on the claimable allowlist
- `source` present, well-formed, and resolvable
- `temperature.celsius` within −5…130, reusing the parser's existing bounds
- `location.elevation` plausible
- claim does not duplicate an existing active claim with the same value
- diff-size cap: a first-time contributor touching more than 20 springs is held

Failures post a single comment listing every problem, so an agent can fix them in one
iteration rather than discovering them one at a time.

### Gate 2 — the manager (LLM, capped)

Runs only when Gate 1 passes **and** the contributor's trust level permits, in a job
with access to secrets.

Trigger rules:

- `new` contributors → never automatic. A maintainer applies a `review-me` label.
- `known` and above → automatic on push.

Emits a structured verdict — `approve`, `reject`, or `escalate`, with reasoning — as a
PR comment.

**The manager cannot merge.** It has no write access beyond commenting and labelling.
Approval by the manager marks the PR mergeable; the merge itself is performed by the
repository's own automation only for low-risk claims from `trusted` contributors.

**Prompt-injection containment.** The manager reads PR bodies and claim text written by
strangers. That text is data, never instructions. Mitigations: no tool access, a strict
output schema that admits only the three verdicts plus reasoning, and no ability to
alter files, labels outside a fixed set, or its own trigger conditions. A submission
whose text attempts to direct the manager is itself grounds for `escalate`.

### Gate 3 — human

`escalate` requests review from the maintainer and applies `needs-human-review`.

## Privacy gate

**This runs in the trusted job (Gate 2's context), not in public CI.**

An earlier sketch had public CI check submissions against hashed geohashes of the
exclusion list. That is wrong and was discarded: geohash space is small enough to
enumerate offline, so publishing hashes publishes the locations. Committing anything
derived from the exclusion list defeats the list.

Instead the real `exclusions.json` is supplied to the trusted job from an Actions
secret (a private companion repo if it ever outgrows the 48 KB secret limit). The check
is a required status, so no PR merges without it, and untrusted PRs already cannot
merge without maintainer action — so nothing is lost by not running it publicly.

Checks performed:

- does the claim create or modify a spring within an exclusion radius?
- does it attempt to relocate a spring *toward* one?
- does a new spring's name match an exclusion name pattern?

Any hit: reject, and **the rejection comment says only that the submission was declined
on privacy grounds.** It must not say which rule matched, how close the spring was, or
in which direction — a detailed rejection is an oracle for locating exactly what the
list protects.

A privacy rejection resets the contributor to `new` and flags the account. This is not
a trust dip; it is a trust reset.

## Token budget guardrails

The hard constraint is that outsiders can never spend the owner's tokens. Three
independent mechanisms, in order of strength:

1. **Structural.** Gate 2 uses the `pull_request` trigger, so GitHub does not expose
   repo secrets to forked PRs. `pull_request_target` is forbidden in this repo. A
   stranger cannot reach the API key, so the guarantee does not depend on our code
   being careful.
2. **Trust-gated.** `new` contributors require a maintainer label before the manager
   runs. Spam costs one click, not tokens.
3. **Metered.** Gate 2 checks a monthly spend ledger before each call. Over cap, it
   skips the LLM, labels `needs-human-review`, and comments that the budget is
   exhausted. Concurrent runs may overshoot slightly; the cap is a guardrail, not an
   accountant.

The key is `ANTHROPIC_API_KEY`, a **separate API key with its own spend limit set at
the provider**, never the owner's Claude subscription credentials.

## Trust levels

`data/contributors.json`:

```json
{
  "github:someone": {
    "accepted": 3, "rejected": 0, "contested": 1,
    "level": "known", "firstSeen": "2026-03-01", "lastSeen": "2026-08-20"
  }
}
```

Deliberately arithmetic, not statistics. There is no data to fit a model to yet.

| Level | Promotion rule | Grants |
|---|---|---|
| `new` | default | Gate 1 only; manager needs a maintainer label |
| `known` | ≥ 1 accepted, acceptance ≥ 0.7 | manager runs automatically |
| `trusted` | ≥ 5 accepted, acceptance ≥ 0.9 | low-risk claims may auto-merge on manager approval |

Demotions:

- Any privacy rejection → straight to `new`, flagged.
- Acceptance dropping below a level's threshold → demote immediately.
- Dormant beyond 12 months → drop one level, because a dormant account is a
  compromise target.

High-risk claims never auto-merge regardless of level.

## Self-improvement

Instrument now; learn later.

`data/events.jsonl`, append-only, one JSON object per line:

```json
{"ts":"2026-08-25T04:00:00Z","type":"claim.contested","springId":"whs_a1b2c3",
 "claimPath":"temperature.celsius","from":38,"to":42,"actor":"build","pr":null}
```

Event types: `claim.proposed`, `claim.gate_failed`, `claim.approved`,
`claim.rejected`, `claim.contested`, `claim.reaffirmed`, `claim.superseded`,
`spring.appeared`, `spring.disappeared`, `review.escalated`, `budget.exhausted`.

Once ~100 reviewed submissions exist, this log supports three things, none of which is
built now: contributor trust scoring on evidence rather than arithmetic; gate efficacy
review (a gate that never fires is noise, one that always fires should run earlier);
and source reputation, weighting claims by whether that domain's claims survive being
contested.

## Changes to existing code

- `scripts/lib/identity.mjs` — new. `isSameSpring()` moves here from
  `build-dataset.mjs`; adds registry resolve and id minting.
- `scripts/lib/overlay.mjs` — new. Load claims, merge, detect drift, assert claim
  accounting.
- `scripts/lib/events.mjs` — new. Append-only writer.
- `scripts/build-dataset.mjs` — insert identity resolve and overlay merge between
  dedupe and the privacy filter; replace `new Date()` in `metadata.generated`.
- `scripts/validate-overlay.mjs` — new. Gate 1, runnable locally so contributors can
  self-check before submitting.
- `.github/workflows/` — `gate.yml` (Gates 0–1), `manager.yml` (Gate 2 + privacy).
- `docs/DATA.md` — document the overlay layer and merge semantics.
- `CONTRIBUTING.md` — document the claim format and the trust ladder.

## Testing

- **Overlay merge:** claim overrides derived value; unclaimed fields still track OSM;
  drift emits `contested`; a claim on a spring absent this build is preserved.
- **Identity:** OSM-ref match; proximity fallback; new id minted; disappearance
  recorded rather than deleted; ids stable across two builds.
- **Determinism:** build twice from identical inputs, assert byte-identical output.
- **Gates:** rejects non-claimable field, bad schema, out-of-range temperature,
  unresolvable source, oversized first-time diff; path guard rejects a `scripts/` edit.
- **Privacy (highest priority):** a claim inside an exclusion radius is rejected **and**
  absent from output; a relocation toward an exclusion is rejected; rejection text
  leaks no location detail. These run against a synthetic exclusion list in the test
  fixture, never the real one.
- **Claim accounting:** an active claim silently missing from output fails the build.

## Risks

| Risk | Mitigation |
|---|---|
| Overlay merge silently drops claims | Claim-accounting assertion fails the build |
| Manager talked into approving by PR text | No tools, strict output schema, cannot merge, injection attempt → escalate |
| Detailed privacy rejections become a location oracle | Rejection text is deliberately uninformative |
| Committed 6 MB artifact produces unreviewable diffs | Deterministic build; reviewers read the overlay diff, not the artifact |
| Spend ledger races across concurrent runs | Accepted; cap is a guardrail and the structural protections are primary |
| Actions minutes on a private repo (2,000/mo free) | Gates are seconds; manager is label-gated for untrusted PRs |

## Build order

Each phase is independently useful and independently shippable. **The implementation
plan that follows this spec covers phase 1 only**; later phases get their own plans,
because phase 2 onward depends on how phase 1's claim format survives contact with
real data.

1. **Identity + overlay + determinism.** Local only, no contributions. Registry, claim
   format, merge, drift detection, events, tests. This is the foundation and the only
   phase that touches the existing build.
2. **Gates 0–1 + local validator.** PRs become safe to accept manually.
3. **Manager + budget ledger + trust levels.** Review becomes semi-automatic.
4. **Drift queue.** `claim.contested` and `spring.disappeared` become review tasks.
5. **Later, on evidence.** Adaptive trust and source reputation, once the log has ~100
   reviewed submissions.

## Open question

Whether to later add a thin MCP adapter that turns an agent's structured proposal into
a PR (the "both" option from brainstorming). Deferred deliberately: it is additive,
it changes nothing in this design, and it should not be built until phase 3 proves the
review loop works.
