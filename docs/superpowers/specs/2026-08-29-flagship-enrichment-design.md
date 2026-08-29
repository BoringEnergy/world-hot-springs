# Flagship enrichment: filling the atlas

Design note — 2026-08-29

Companion to `2026-08-25-agent-contribution-system-design.md`. This is the
first sub-project of the enrichment track, and it is deliberately independent
of phase 3: it introduces no secret, no CI trigger, and no trust levels.

## The problem this exists to solve

The atlas has 6,471 springs across 129 countries and knows almost nothing about
them:

| Field | Known | Share |
|---|---|---|
| temperature | 87 | 1.3% |
| price | 878 | 13.6% |
| hours | 466 | 7.2% |
| clothing | 47 | 0.7% |

**It is a hot spring atlas that does not know how hot the springs are.** That
is inherited honestly from OpenStreetMap, and `data/overlay/` exists precisely
to fix it — but the overlay is empty. Every mechanism built in phases 1 and 2
is a machine for producing something that does not yet exist.

Phase 2's gate was proven working on 2026-08-28 with two real pull requests. An
agent can write overlay files and open a PR against it today. Nothing about
this sub-project is blocked.

## Depth, not breadth

The first pass makes **100–300 springs excellent** rather than making all 6,471
marginally less thin.

Three reasons. 6,471 thin records is what the atlas already is; reducing the
thinness slightly does not change what it *is*. A few hundred excellent records
set the quality bar that every future contribution is measured against, and
right now there is no bar at all, because no authored claim exists. And a
detail panel worth designing needs a record with something in it — the
experience sub-project is blocked on this one, not the other way round.

The counterargument was recorded and rejected knowingly: *"the atlas that knows
how hot every spring is"* is a cleaner public claim than *"the atlas with 200
great entries."* Breadth on temperature remains the obvious second pass, and it
will be cheaper and better-aimed for having done this one first.

## Selection: country spread, capped

The dataset is lopsided. The United States (2,025) and Japan (950) are 46% of
all records. Selecting by name recognition would deepen that into a superb
atlas of American and Japanese springs with a thin tail everywhere else.

Selection therefore caps at **5–10 springs per country** and prioritises spread
across the 129. This makes the first 200 records genuinely global, which is what
"world's first" has to mean to be worth saying.

It is also the harder choice, and that is the point: sources for Bolivian,
Georgian, or Taiwanese springs are thinner and frequently not in English. That
is exactly where a multi-provider setup earns its complexity, because models
differ far more in non-English retrieval than they do on the Blue Lagoon.

The selected set is written to **`data/flagship.json` as a committed list of
ids**. The target set must be reviewable, stable, and diffable — not recomputed
differently on every run by a function nobody inspected.

## Pipeline

```
select flagship set  →  propose (provider A)  →  fetch-check  →  refute (provider B)  →  emit
   deterministic          value + source URL      does the source     survives → claim      overlay JSON
   country-capped                                 actually say it?    fails → Unknown       + PR
```

| File | Responsibility |
|---|---|
| `scripts/lib/flagship.mjs` | Pure. Dataset + per-country cap → the target set. Deterministic. |
| `scripts/lib/providers/*.mjs` | One uniform interface per provider: `complete({system, user, schema}) → object`. |
| `scripts/lib/verify-source.mjs` | Fetch a cited URL; confirm the claimed value appears in it. |
| `scripts/enrich.mjs` | The CLI composing the above. |

## Where it runs, and why that matters

**A local CLI, run by an operator on their own credential.** Not CI.

This is not a temporary convenience. It dissolves the entire problem that
blocks phase 3: there is no secret in the repository, so nothing can leak one;
there is no maintainer spend exposure, because whoever runs the tool spends
their own credential; and there is no `workflow_run` trigger to secure. The
output is overlay JSON, which `gate-1` already validates.

It also implements the intended trust model — *agent only, no humans in the
loop except the maintainer and whoever they approve* — without building
anything. The allowlist is "who can open a pull request," which GitHub already
enforces, rather than a `contributors.json` that would have to be designed,
stored, and secured.

Lifting this into CI later is a deliberate decision requiring the phase 3
credential and ledger questions to be answered first. The CLI should hold no
opinion about where it runs, but nothing here anticipates that move.

## Provider abstraction

Providers are pluggable and no provider is privileged. Anthropic, OpenAI,
Google, xAI, or a local model are all just an implementation of:

```js
complete({ system, user, schema }) -> object
```

Configuration names which providers are available and which role each plays.

**The one hard rule: the proposer and the verifier must be different
providers.** Enforced in code, asserted by a test. A model refuting its own
claim is theatre, and this constraint is the entire reason multi-provider is
worth its complexity. If only one provider is configured, the run must fail
with that explanation rather than silently degrading to self-review.

## Verification

Two lines of defence, deterministic first.

**1. Fetch-check.** Retrieve the cited URL and confirm the claimed value
actually appears in it. This is free, deterministic, and it catches the
dominant failure mode — a confident value attached to a fabricated or
irrelevant citation.

**2. Adversarial refutation.** A different provider receives the fetched source
text and the claim, and is asked to refute it. This catches the subtler case
the fetch-check cannot: a real source that says 40 °C about a *different pool*
at the same resort.

Survives both → the claim lands. Fails either → the field stays Unknown and the
attempt is logged.

### Why not N-way agreement

Plain multi-model agreement was considered and rejected. Models trained on
overlapping web corpora will confidently repeat the same wrong number; two
models agreeing on a hallucination is correlated error, not evidence.
Refutation is strictly stronger than agreement, and it is the pattern that has
already found real defects in this repository twice — the six-hex id collision
and the F1 path to the API key.

## Unknown is a valid answer

SPEC.md: *"Do not fill a field to make a record look complete... The
completeness score is a measurement, not a target."*

A spring where nothing survives verification produces **no overlay file at
all** — not an empty one, not a file with nulls. This is enforced by
construction rather than by discipline, and it is the single most important
behavioural property of this system.

The characteristic failure of an enrichment agent is filling a field with a
plausible value rather than returning nothing. Success is therefore **not**
measured in fields filled. A run that enriches 40 of 200 springs and correctly
declines the other 160 is a good run.

## Two defects in existing code, to fix in this pass

Both were found while designing this, and both are the kind that only an agent
operating at scale would ever hit.

**`validateOverlay` never checks that a spring id exists.** It validates the
*shape* of an id — `whs_` plus 12 hex characters — but an overlay file for
`whs_000000000000` validates cleanly today and silently attaches to nothing. A
human writing one file by hand would never hit this. An agent generating
hundreds will. The validator must check membership against the published
dataset.

**`location.nearestTown` is claimable.** On a borderline spring, an agent
adding a nearest town is a material increase in findability — the one thing
SPEC.md calls non-negotiable. Agent enrichment must therefore use a narrower
field set than humans get.

### The agent-claimable set, explicitly

Agents may claim exactly these thirteen fields — the factual, sourceable ones:

```
temperature.celsius
access.price, access.currency, access.notes
clothing.policy, clothing.schedule, clothing.notes
hours.open, hours.seasonalNotes, hours.status
description
location.elevation, location.region
```

Four of `CLAIMABLE`'s seventeen are withheld, each for its own reason:

| Withheld | Why |
|---|---|
| `location.nearestTown` | Findability. The privacy rule outranks completeness. |
| `name` | OSM is usually right, and a renamed spring is hard to recognise as wrong later. |
| `warnings` | Safety-critical and merge-only, so a fabricated warning can never be removed by another claim. Over-warning erodes trust as surely as under-warning. |
| `tags` | Merge-only and unbounded; an agent filling it produces noise nobody can later prune. |

This is a first-pass posture, not a permanent judgement. `warnings` in
particular is worth revisiting once the refutation step has a track record —
an agent that reliably finds *sourced* scalding risks would be valuable.
Conservative first, on the principle that a withheld field can be granted later
but a bad claim is already published.

## Privacy

Enrichment only ever attaches claims to springs **already present in the
published dataset**, which have already passed the exclusion filter. The agent
cannot add a spring; with the id-existence check above, it cannot even name one
that does not exist.

The exclusion filter remains last in the pipeline and is untouched by this
work. Nothing here reads `data/private/`.

The narrowed field set is the second control: enrichment may sharpen what is
known about a public spring, never make a marginal one easier to find.

## Testing

Mirroring what worked in phases 1 and 2 — each test maps to a way this fails.

1. Selection is deterministic: same dataset and cap produce the same set.
2. Selection respects the per-country cap and spans the expected country count.
3. `verify-source` detects a value present in fixture HTML, and detects its
   absence — both directions, since a checker that always passes looks
   identical to one that works.
4. A claim whose cited URL does not contain the value is rejected.
5. Proposer and verifier being the same provider is refused, not warned about.
6. A single configured provider fails the run with an explanatory error.
7. **A spring with no findable sources produces zero files.** The most
   important test here.
8. An overlay file naming a nonexistent spring id is rejected by the validator.
9. `nearestTown` is refused from an agent-authored claim.
10. End-to-end against mocked providers produces overlay files that pass the
    existing `validate-overlay` CLI unmodified.

## Cost

Roughly two model calls per spring — one proposal, one refutation — so about
400 calls for a 200-spring set, plus fetches. Borne by whoever runs the CLI.
There is no shared budget to bound and no ledger to make durable, which is the
F8 problem deleted rather than solved.

## The benchmark, which costs nothing

`validateOverlay` already requires a `contributor` field on every claim, and it
is free-form. So `"contributor": "openai:gpt-5"` versus
`"anthropic:claude-opus-5"` versus `"google:gemini-3"` is already a legal,
committed, permanent record of which model produced which claim. Disagreements
already have a home: `data/events.jsonl` records them as `claim.contested`.

**The provenance schema for a cross-provider benchmark already exists in the
repository.** Nothing needs building for it. Whether to publish comparative
results is a separate decision, deliberately not made here.

## Out of scope

The CI lift, the spend ledger, trust levels, `contributors.json`, auto-merge,
new-spring proposals, the breadth pass on temperature, and any change to the
site itself. Each is its own spec.

## Open questions

- The exact per-country cap (5 or 10) should be set by looking at how many
  countries actually clear a source-availability bar, not chosen in advance.
  Measure before fixing it — thresholds in a plan are assertions, not
  decisions, and this repository has been bitten by that twice.
- Whether a refuted claim should be recorded anywhere. Logging what the atlas
  declined to assert may be more interesting than what it asserted, but it is
  also a public record of "this source is wrong," which deserves its own
  thought.
