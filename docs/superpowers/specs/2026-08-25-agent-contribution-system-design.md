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
| D6 | **Risk tiers track physical harm, not effort to fix.** Four tiers: low, elevated, high, always-human. | A wrong temperature can burn someone; a wrong name is a discoverability problem. Three tiers forced `name` into a bucket that overstated its danger. |
| D7 | **`type` is pipeline-owned, not claimable.** | Verified in code: it drives a safety warning and the completeness score. Reclassification is a separate human-reviewed operation. |
| D8 | **Trust counts reviewed submissions, not claims, and capabilities are named separately from levels.** | One PR touching twenty fields must not vault a stranger to `trusted`. Naming capabilities stops `level >= known` being reused later for an unrelated permission. |
| D9 | **Gate 2 triggers via `workflow_run`; `pull_request_target` is forbidden.** | The only way a fork PR can reach a privileged reviewer without handing attacker-controlled code a secret-bearing context. Hardened design and threat model: [gate-2-trigger-security](2026-08-25-gate-2-trigger-security.md). Adversarial review of the first draft found a path to the secret; read that document before implementing phase 3. |

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

**Claimable:** `name`, `temperature.celsius`, `access.price`, `access.currency`,
`access.notes`, `clothing.policy`, `clothing.schedule`, `clothing.notes`,
`hours.open`, `hours.seasonalNotes`, `hours.status`, `description`, `tags`,
`warnings`, `location.elevation`, `location.region`, `location.nearestTown`.

**Never claimable:** `id`, `unicorn`, `quality.*`, `verified`, `sources`,
`location.lat`, `location.lng`, `type`, `temperature.source`,
`temperature.measuredAt`.

### Why `type` is not claimable

The rule is: `type` would be claimable only if it were a closed descriptive enum with
no effect on inclusion, privacy, identity, safety derivation, or quality scoring. It
fails on two counts, verified in the code rather than assumed:

- `scripts/lib/normalize.mjs:203` — `type === 'wild'` emits the warning *"Undeveloped
  source: no staff, no facilities, and no maintained access."* **Safety derivation.**
- `scripts/lib/normalize.mjs:228` — a known `type` contributes to the completeness
  score. **Quality scoring.**

It also drives the UI's type filter, so it affects discoverability. It is *not* used in
identity or dedupe — `isSameSpring()` keys off the OSM element type embedded in the id
string, not `record.type` — and not in privacy or inclusion.

`type` is therefore pipeline-owned classification, closer to `quality.*` than to
`description`. Reclassification is a separate **always-human** operation: a `reclassify`
proposal carrying evidence, reviewed by a person, which rewrites the derived
classification rule or pins the record. It never arrives as an ordinary claim.

### Why temperature provenance is claim metadata, not fields

`temperature.source` and `temperature.measuredAt` are deliberately absent from the
allowlist. Every claim already carries a `source`, and the merge accrues it into the
record's `sources`. Allowing a separate claim on `temperature.source` would create two
competing provenance concepts — the provenance *of the claim* and a claimed
provenance-shaped *field inside the record* — which can drift apart or contradict each
other, and would let someone submit a valid temperature and then independently
overwrite the date it was measured.

So there is exactly one temperature claim, and it carries its own provenance:

```json
"temperature.celsius": {
  "value": 38,
  "source": "https://example.org/survey",
  "measuredAt": "2026-03-14",
  "contributor": "github:someone",
  "state": "active"
}
```

The merge derives `temperature.source` and `temperature.measuredAt` in the output
record from the active claim. They are readable in the dataset and unforgeable
independently of the value they describe.

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

Tier drives who can approve, not whether a claim is allowed. Four tiers, because three
forced `name` into a bucket that overstates its danger.

The tiers track **physical harm if wrong**, not effort to fix. A wrong temperature can
burn someone; a wrong name is a discoverability problem.

- **Low** — `hours.open`, `access.price`, `access.currency`, `description`, `tags`,
  `location.region`, `location.nearestTown`, `location.elevation`. Cheap to reverse,
  low harm if wrong.
- **Elevated** — `name`, `access.notes`, `hours.seasonalNotes`, `hours.status`. Wrong
  values mislead or waste a trip; none of them hurt anybody.
- **High** — `temperature.celsius` (the scalding warnings derive from it), `clothing.*`
  (a wrong policy walks someone into a genuinely bad situation), `warnings`.
- **Always human** — creating a new spring, any relocation, any `reclassify` of `type`,
  any `retract` of a derived warning, anything touching a record whose registry entry
  is flagged.

`name` interacting with privacy is handled where it belongs: new-spring names are
checked against exclusion name patterns inside the trusted privacy gate. That does not
require every ordinary rename to be high-risk.

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

Its purpose is **fast feedback for the contributor**, not security. On a fork PR the
workflow file itself comes from the PR head, so a determined submitter can make it
report whatever they like. Gate 2 re-runs all of it from trusted code and does not
believe this one.

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

Runs only when Gate 1 passes **and** the contributor holds `CAN_AI_REVIEW`, in a job
with access to secrets.

#### Trigger mechanism — the most security-sensitive detail in this design

There is a real contradiction to resolve here, and phase 3's implementation plan should
spend disproportionate time on it.

`pull_request` gives forked PRs no secrets. That is good for safety and fatal for
"`known` and above → automatic on push": a `known` contributor working from a fork
cannot reach the API key either, so trust in `contributors.json` would grant a
capability GitHub refuses to deliver.

`pull_request_target` is **forbidden in this repository.** It runs with secrets in the
base-repo context while the PR's contents are attacker-controlled, and it is the source
of most GitHub Actions privilege-escalation writeups.

The mechanism is **`workflow_run`**, with rules:

1. Gate 2 triggers on Gate 1's `workflow_run: completed`. GitHub runs it using the
   workflow definition **from the default branch**, not the PR's copy. A PR therefore
   cannot edit the workflow that reviews it, which is the property `pull_request_target`
   lacks.
2. **Gate 2 never checks out or executes PR-authored code.** It fetches only the changed
   files under `data/overlay/**` by content API at a pinned SHA, and treats every byte
   as untrusted data.
3. **Gate 1's result is a UX signal, never a security input.** For a fork PR, the
   `pull_request` workflow file itself comes from the PR head and is attacker-controlled
   — an attacker can rewrite `gate.yml` to report success. Gate 2 therefore re-runs the
   path guard and the full deterministic validation itself, using scripts from the
   default branch. Anything Gate 1 says is advisory.
4. Gate 2 re-derives every security-relevant fact from trusted sources: PR author, head
   SHA, and changed-file list from the API; trust level from `contributors.json` on the
   default branch. Never from the artifact.
5. The head SHA validated is pinned into the verdict. If the PR moves afterwards, the
   verdict is void and review re-runs.

Trigger rules, given that mechanism:

- `new` contributors → Gate 2 exits within seconds, before any LLM call, and applies
  `needs-human-review`. A maintainer's `review-me` label is the only way forward.
- `CAN_AI_REVIEW` holders → the manager runs automatically on push.

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

The hard constraint is that outsiders can never spend the owner's tokens.

**A correction to an earlier draft of this document.** It claimed the guarantee was
structural, on the grounds that GitHub withholds secrets from forked PRs. That claim
does not survive the `workflow_run` trigger above: a stranger's PR *does* cause a
privileged workflow to start. The protection is real but narrower than stated, and the
weight shifts to mechanism 2.

1. **Isolation.** The API key is never reachable from PR-authored code. Gate 2 runs the
   default branch's workflow definition, checks out no PR code, and executes none. An
   attacker can cause the workflow to *start*; they cannot influence what it *does*.
2. **Trust-gated, and this is now the primary protection.** The trust lookup and the
   ledger check are deterministic, free, and run in trusted default-branch code
   **before any LLM call**. A `new` contributor's run exits in seconds having spent
   nothing. Because this is load-bearing, it gets a dedicated test: a fork PR from an
   unknown author must produce zero LLM calls, asserted against a mocked client.
3. **Metered.** Gate 2 checks a monthly spend ledger before each call. Over cap it
   skips the LLM, labels `needs-human-review`, and comments that the budget is
   exhausted. Concurrent runs may overshoot slightly; the cap is a guardrail, not an
   accountant.

The residual cost a stranger *can* impose is GitHub Actions minutes — two short
workflow runs per push, against a 2,000 minute monthly allowance on a private repo.
The early exit in mechanism 2 keeps that to seconds. If it ever becomes a problem,
concurrency groups cancel superseded runs per PR.

The key is `ANTHROPIC_API_KEY`, a **separate API key with its own spend limit set at
the provider**, never the owner's Claude subscription credentials.

## Trust levels

`data/contributors.json`:

### Capabilities are named, not inferred from level

Trust currently bundles three things that may later diverge: permission to consume LLM
budget, historical contribution quality, and permission to auto-merge. Name the
capabilities explicitly so nobody later writes `level >= known` for an unrelated
permission:

```text
CAN_VALIDATE     deterministic gates only          — everyone, including anonymous
CAN_AI_REVIEW    may trigger a paid manager run    — known and above
CAN_AUTO_MERGE   low-risk claims merge unattended  — trusted, and only when active
```

Code checks the capability, never the level.

### Counting

**`accepted` and `rejected` count reviewed submissions (PRs), not individual field
claims.** Without that rule, one PR touching twenty harmless fields would vault a
stranger from `new` to `trusted` in a single action. Both are tracked; only submissions
gate promotion.

```json
{
  "github:someone": {
    "acceptedSubmissions": 6, "rejectedSubmissions": 1,
    "acceptedClaims": 31, "rejectedClaims": 2,
    "contested": 1, "level": "known",
    "firstSeen": "2026-03-01", "lastSeen": "2026-08-20"
  }
}
```

### Ladder

| Level | Promotion rule | Capabilities |
|---|---|---|
| `new` | default | `CAN_VALIDATE` |
| `known` | ≥ 3 accepted submissions, acceptance ≥ 0.75 | `+ CAN_AI_REVIEW` |
| `trusted` | ≥ 10 accepted submissions, acceptance ≥ 0.90 | `+ CAN_AUTO_MERGE` |

Deliberately arithmetic, not statistics. **The minimum count carries almost all the
weight; the ratio is a tiebreak.** With one accepted submission the acceptance rate is
1.0, and with three it is also 1.0 — the percentage looks strong at sample sizes where
it means nothing, which is the same reason this design refuses to build adaptive
scoring before ~100 reviews. Arguing 0.70 versus 0.75 is not worth the keystrokes;
requiring three real submissions instead of one is.

Three is the first rung because promotion to `known` is a genuine privilege escalation:
it converts an account from *cannot spend our API budget* to *every Gate-1-passing push
can trigger a paid review*. Ten before `CAN_AUTO_MERGE` is proportionate to a
qualitatively different power — data reaching production without a person looking.

Demotions:

- Any privacy rejection → straight to `new`, flagged. A reset, not a dip.
- Acceptance dropping below a level's threshold → demote immediately.
- Dormant beyond 12 months → drop one level. A dormant account is a compromise target.

`CAN_AUTO_MERGE` additionally requires activity within the last 90 days, checked
independently of level. Twenty pristine submissions from two years ago should not mean
a freshly compromised account merges to production unattended on its first push back.

High-risk claims never auto-merge regardless of level or capability.

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
| Spend ledger races across concurrent runs | Accepted; trust-gating is the primary protection and it precedes the ledger |
| Gate 1's verdict is attacker-controlled on fork PRs | Gate 2 re-runs path guard and validation from default-branch code; Gate 1 is advisory only |
| Stranger burns Actions minutes | Early exit in seconds for `new`; concurrency groups cancel superseded runs if needed |
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
3. **Manager + budget ledger + trust levels.** Review becomes semi-automatic. Budget
   disproportionate time for the `workflow_run` trigger: it is the most
   security-sensitive mechanical detail in the design, and getting it wrong is how
   this repository would leak an API key. Required tests before it ships: a fork PR
   from an unknown author produces zero LLM calls; a PR that rewrites `gate.yml` to
   report success is still rejected by Gate 2's independent re-validation; a verdict
   is void if the head SHA moves.
4. **Drift queue.** `claim.contested` and `spring.disappeared` become review tasks.
5. **Later, on evidence.** Adaptive trust and source reputation, once the log has ~100
   reviewed submissions.

## Open question

Whether to later add a thin MCP adapter that turns an agent's structured proposal into
a PR (the "both" option from brainstorming). Deferred deliberately: it is additive,
it changes nothing in this design, and it should not be built until phase 3 proves the
review loop works.
