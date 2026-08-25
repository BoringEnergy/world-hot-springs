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
