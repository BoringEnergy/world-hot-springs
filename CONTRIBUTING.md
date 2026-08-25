# Contributing

Corrections and additions are welcome. Two things to read first:
[PRIVACY.md](PRIVACY.md), which governs what may be added at all, and
[docs/DATA.md](docs/DATA.md), which explains how records are built.

## The one rule that outranks everything

**Do not submit a spring that the local community or the landowner would not
want publicised.** If you learned about it from someone who told you in
confidence, or from a closed forum, or because you live there and the people who
maintain it keep it quiet — it does not go in.

Submissions that look like a hidden local spring are rejected. That rejection is
not a judgement of you; it is the project working as designed. We will say so
respectfully and we will not publish the location in the process of declining
it.

If you are unsure whether a spring qualifies, the answer is don't submit it. The
cost of leaving a public spring off the map for another month is nothing. The
cost of putting a hidden one on is permanent.

## Requesting removal

You do not need to prove ownership and you do not need to justify it. Removal is
the default answer and it is permanent — the exclusion is stored by geographic
radius, so it survives future data imports even if the spring is re-mapped
upstream under a new id.

If opening a public issue would itself draw attention to the spring, contact the
maintainers privately instead.

## Adding or correcting a spring

The best correction usually isn't a PR here — it's an edit to
**OpenStreetMap**, which flows into the next build and improves every other
project using the same data. Tag `temperature`, `fee`, `charge`,
`opening_hours`, and `nudism` on the spring itself.

If the correction is specific to this dataset (a bad parse, a wrong country
resolution, a duplicate we failed to merge), open an issue or a PR against the
normaliser with:

- The spring's `id` (e.g. `osm-node-123456789`)
- What the record says now and what it should say
- **A public source.** Every record has to be checkable by a stranger. "I was
  there last week" is genuinely useful context, but it cannot be the only
  citation.

## Unknown is a valid answer

Do not fill a field to make a record look complete. If you don't know the
temperature, leave it `null`. A record that says Unknown is more useful than one
that says 40 °C because someone guessed. The completeness score is a measurement,
not a target.

## Working on the code

```bash
npm install
npm run data:fetch   # resumable; cached tiles in data/raw/ are reused
npm run data:build
npm run dev
npm run typecheck
```

`data/raw/` is gitignored — it is large and refetchable. The curated outputs in
`data/` are committed, because the dataset is the deliverable.

If you change a tag mapping in `scripts/lib/normalize.mjs`, update the
corresponding table in [docs/DATA.md](docs/DATA.md) in the same commit. The
reasoning is part of the dataset.

## Correcting a record

The best correction is usually an edit to OpenStreetMap, which flows into the
next build and helps every project using the same data.

When the correction is specific to this dataset, add a claim. Create
`data/overlay/<spring-id>.json`, using the `whs_` id from the record:

```json
{
  "id": "whs_a1b2c3d4e5f6",
  "claims": {
    "temperature.celsius": {
      "value": 38,
      "source": "https://example.org/where-you-got-this",
      "measuredAt": "2026-03-14",
      "contributor": "github:yourname",
      "state": "active"
    }
  }
}
```

Claims are field-level. A claim overrides that one field; every field you do not
claim keeps tracking OpenStreetMap. That is deliberate — it means correcting a
temperature does not freeze the opening hours.

Every claim needs a `source` a stranger can check. "I was there last week" is
useful context but cannot be the only citation.

### Fields you cannot claim, and why

- **`type`** drives a safety warning and the completeness score, so it is
  pipeline-owned classification. Reclassification is reviewed by a person.
- **`temperature.source` and `temperature.measuredAt`** are derived from the
  temperature claim's own metadata. Letting them be claimed separately would let
  someone overwrite the provenance of a reading they did not submit.
- **Coordinates** are not claimable at all. Moving a spring is how you would
  defeat the privacy exclusion radius.

### Fields that merge rather than replace

`tags` and `warnings` merge — a claim adds entries and never removes them.
Removing a derived safety warning is a separate, human-reviewed operation, so
that nobody can strip a scalding notice off a 62 °C spring.

### When your claim disagrees with OpenStreetMap

Nothing breaks. Your value keeps rendering and the disagreement is recorded in
`data/events.jsonl` as a `claim.contested` event for a human to resolve. The
site never regresses to a value you have evidence against.

## Submitting a claim

```bash
npm run validate
```

Run it before you open a pull request. It checks every file in
`data/overlay/`, reports all the problems at once rather than the first, and is
the identical code CI runs — so a clean local run means a clean CI run.

To check only what you changed, as CI does:

```bash
node scripts/validate-overlay.mjs --changed-only
```

### What a pull request may touch

**`data/overlay/**` and nothing else.** A submission that edits a script, a
workflow, the built dataset, or `package.json` is rejected by the path guard
before anything else runs. This is not a judgement of the change — a pipeline
improvement is welcome, it just travels as its own pull request from a
different starting point, because the automation that reviews contributions
must not be editable by the contribution it is reviewing.

Files are named `<spring-id>.json` and the id inside must match the filename.
A mismatch makes the file invisible to anyone grepping the directory for a
spring.

### The green check is feedback, not approval

The `gate-1` check reports whether the validator was happy. It is contributor
convenience and a signal to the maintainer — deliberately not a security
boundary, because on a fork pull request the workflow file itself comes from
the pull request. **Every submission in this phase is read by a human before it
merges.** A green check means your file is well-formed; it says nothing about
whether the claim is true, and nothing about whether the spring belongs on the
map at all. That first rule at the top of this document is still the one that
outranks everything.

Removing an overlay file is a legitimate submission — retracting a claim, or a
removal request. The validator reports it as a removal rather than an error,
and a person reviews it, because deleting authored claims discards work no
rebuild will bring back.
