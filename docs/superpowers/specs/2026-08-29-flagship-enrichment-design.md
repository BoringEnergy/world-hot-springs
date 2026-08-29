# Flagship enrichment: filling the atlas

Design note — 2026-08-29

Companion to `2026-08-25-agent-contribution-system-design.md`.

**This is phase 3.** The work previously numbered phase 3 — the LLM manager
running under Gate 2 in CI — is renumbered **phase 4** and remains blocked on
F8 (naming a durable ledger store) and F9 (a spend-capped credential), neither
of which is done. This sub-project was promoted ahead of it because it is
unblocked today and because it produces the thing every earlier phase was built
to carry: an authored claim, of which the repository currently has none.

It introduces no secret, no CI trigger, and no trust levels.

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

## Selection: two per country, over-provisioned

The dataset is lopsided. The United States (2,025) and Japan (950) are 46% of
all records. Selecting by name recognition would deepen that into a superb
atlas of American and Japanese springs with a thin tail everywhere else.

### The cap does not do what it looks like it does

Measured against the real distribution before choosing a number:

| Cap | Countries reached | Springs selected |
|---|---|---|
| 1 | 129 | 129 |
| 2 | 129 | 237 |
| 3 | 129 | 331 |
| 5 | 129 | 492 |
| 10 | 129 | 827 |

**Every cap reaches all 129 countries.** A cap only trims the top of the
distribution; every country still contributes `min(n, cap)`, which is at least
one. Country spread is achieved at a cap of 1 and cannot be improved by raising
it.

This corrects an earlier draft of this document, which set the cap at 5–10 "to
prioritise spread across the 129." That reasoning was wrong — it attributed to
the cap a property the cap does not have. The mistake is preserved here because
it is the third time in this repository that a number in a plan turned out to
be an assertion nobody had measured, and the first two each shipped a defect.

**The cap is a volume dial, nothing more.** It is therefore chosen from the
target volume: **2**, giving 237 springs, the middle of the 100–300 band. 108
countries have two or more springs; the remaining 21 contribute their only one.

### Two per country is a target, not a quota

A flat "take exactly two" fails badly on contact with reality: where both
candidates have no findable source, that country silently gets nothing, and the
run cannot tell that outcome apart from not having tried.

So `data/flagship.json` records, per country, an **ordered candidate list** of
up to five ids. A run works down each country's list until **two claims survive
verification** or the list is exhausted. Candidate order is deterministic, so
the file stays reviewable, stable, and diffable — never recomputed differently
on each run by a function nobody inspected.

This makes the unit of success per-country rather than global, which is what
makes a partial run legible: *Chile got its two, Bolivia got none from five
candidates.* Aggregated, that is a map of **where public information about hot
springs does not exist** — an output of the run that is arguably more
interesting than the claims themselves, and one no amount of model capability
can fake.

It is also the harder selection, and that is the point: sources for Bolivian,
Georgian, or Taiwanese springs are thinner and frequently not in English. That
is exactly where a multi-provider setup earns its complexity, because models
differ far more in non-English retrieval than they do on the Blue Lagoon.

## Pipeline

```
per country, next candidate
        │
        ▼
   propose (provider A) ──▶ fetch-check ──▶ refute (provider B) ──▶ overlay JSON
   value + source URL      does the source   survives → claim         + PR
                           actually say it?
                                 │                   │
                            fails│              fails│
                                 ▼                   ▼
                          data/refutations.jsonl (outcome + stripped note)
                                 │
                                 ▼
                    next candidate, until 2 succeed or list exhausted
                    exhausted → country reported unmet, no file written
```

| File | Responsibility |
|---|---|
| `scripts/lib/flagship.mjs` | Pure. Dataset → ordered per-country candidate lists. Deterministic. |
| `scripts/lib/providers/*.mjs` | One uniform interface per provider: `complete({system, user, schema}) → object`. |
| `scripts/lib/verify-source.mjs` | Fetch a cited URL; confirm the claimed value appears in it. |
| `scripts/lib/refutations.mjs` | Append to the refutation log. Owns the outcome enum and the note stripper. |
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

## Recording refutations

What the atlas *declined* to assert is recorded. It is the more interesting
half of the output: an assertion is one fact, a refutation is a fact about the
state of public knowledge.

**A separate log: `data/refutations.jsonl`.** Append-only, committed, one JSON
object per line — the same shape as `data/events.jsonl` but deliberately not
the same file, for two reasons. `events.jsonl` is written by the build and
deduplicated on `[type, springId, claimPath, to]`, which would collapse "GPT
proposed 40 °C and was refuted" and "Gemini proposed 40 °C and was refuted"
into a single line — destroying exactly the comparative signal that makes this
worth logging. And the two have different producers and cadences: the build
writes one on every run, the enrichment CLI writes the other only when a human
runs it.

```json
{
  "ts": "2026-08-29T12:00:00.000Z",
  "springId": "whs_b803e624c229",
  "field": "temperature.celsius",
  "proposed": 40,
  "source": "https://example.org/page",
  "proposer": "openai:gpt-5",
  "verifier": "anthropic:claude-opus-5",
  "stage": "fetch-check",
  "outcome": "value-absent-from-source",
  "note": "<= 280 chars, plaintext"
}
```

### Three rules, each load-bearing

**1. `outcome` is a closed enum written by our code, never by a model.**
`source-unreachable`, `value-absent-from-source`, `different-subject`,
`refuted-by-verifier`. A free-text outcome is unqueryable within a month and
lets the model grade its own homework.

**2. `note` is treated as hostile on output.** It is model-authored text
committed to a public repository that future agents will read. That is
precisely the second-order injection the Gate 2 spec identifies as F2 — the
containment there was insufficient for the same reason it would be here. Cap
the length, strip to plaintext, remove links, images, HTML, and `@`/`#`
references before writing. The threat model does not weaken because the sink is
a file rather than a pull request comment.

**3. A refuted value must never reach the site.** These are research artifacts,
not claims. The build must not read `data/refutations.jsonl`, and a test
asserts it — otherwise the file becomes a back door for publishing exactly the
values the verification step rejected.

### Say "we could not confirm", not "the source is wrong"

The log records our inability to verify, not a verdict on a third party. Our
fetch-check can be wrong: the page changed, JavaScript rendered the value,
the crawler was blocked. `value-absent-from-source` is an honest description of
what we observed. "This source publishes false information" is an accusation
this pipeline is not entitled to make, and it would be committed to a public
repository under the project's name.

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
2. Selection spans all 129 countries and no country exceeds its candidate list
   length.
3. A country whose first candidates all fail falls through to later ones, and a
   country whose whole list is exhausted yields no file and is reported as
   unmet rather than skipped silently.
4. A refutation is written with a closed-enum `outcome`; a model-supplied
   outcome string is rejected.
5. A `note` containing a markdown image, a link, and an `@mention` is stripped
   before being written.
6. The build does not read `data/refutations.jsonl` — asserted, so a refuted
   value can never reach the site.
7. `verify-source` detects a value present in fixture HTML, and detects its
   absence — both directions, since a checker that always passes looks
   identical to one that works.
8. A claim whose cited URL does not contain the value is rejected.
9. Proposer and verifier being the same provider is refused, not warned about.
10. A single configured provider fails the run with an explanatory error.
11. **A spring with no findable sources produces zero files.** The most
    important test here.
12. An overlay file naming a nonexistent spring id is rejected by the validator.
13. `nearestTown` is refused from an agent-authored claim.
14. End-to-end against mocked providers produces overlay files that pass the
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

## Decisions closed since the first draft

Both open questions are settled, and the answers are recorded above rather than
here so nobody implements from a stale summary.

- **The cap.** Measured, and the measurement invalidated the reasoning behind
  the original number. Two per country, over-provisioned to five candidates.
- **Refutations.** Recorded, in their own log, with the three rules that keep
  the record honest and non-injectable.

## The coverage map is published — decided 2026-08-29

The per-country unmet report ships as a committed artifact,
**`data/coverage.json`**, regenerated on every run and part of the permanent
record.

The reasoning that made this a question was that it is a public statement about
which countries the internet has failed to document. On reflection that is an
argument *for* publishing, not against. The map does not measure a country; it
measures the reach of English-language, indexable, public web sources — and
saying so out loud is more honest than quietly holding a thin record and
letting a reader assume the springs are thin.

It is also the only part of this system that improves by being wrong in public.
Someone who knows the Bolivian sources exists is far more likely to appear if
the atlas says plainly that it could not find them.

The artifact must therefore carry its own framing, in the file, not only in a
README somebody will not read:

```json
{
  "generatedAt": "2026-08-29T12:00:00.000Z",
  "measures": "reach of public, indexable sources this run could verify — not the number of hot springs a country has, and not their quality",
  "countries": [
    { "country": "CL", "candidates": 5, "attempted": 3, "verified": 2, "unmet": 0 },
    { "country": "BO", "candidates": 5, "attempted": 5, "verified": 0, "unmet": 2 }
  ]
}
```

## Still genuinely open

- **Candidate ordering within a country.** Deterministic is required; *which*
  deterministic order — completeness score, name presence, OSM edit recency —
  is unmeasured. Pick it the way the cap was picked, not the way the cap was
  first guessed. Task 2 of the plan measures it rather than assuming it.
