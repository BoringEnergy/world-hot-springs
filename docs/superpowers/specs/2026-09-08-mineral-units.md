# What unit is a mineral figure in?

Written 2026-09-08. Status: recommendation, awaiting a decision.

`minerals.tds` is documented as mg/L. The first real chemistry source publishes
71% of its rows in **mg/kg**. This decides what the atlas does about that, and
it is not an AIST question — it will recur with every non-US analysis, because
mg/kg is the normal unit in Japanese and German spring chemistry.

## What the data actually says

Measured against AIST's 7,203 rows, which is the only chemistry source examined
so far.

    mg/kg   5,129        mg/l   1,766        no unit   307
    rows with at least one panel value: 7,004
    ...of those, carrying chemistry but NO unit label: 112

**Conversion is impossible for three quarters of the rows that would need it.**
mg/kg → mg/L needs the solution density. `比重` is present on 1,381 rows in
total and on only **1,335 of the 5,129 mg/kg rows (26%)**.

**Where density exists, the difference is small but not invisible.**

    比重: min 0.9097 | p05 0.998 | median 1.0001 | p95 1.0082 | max 1.09
    within 1% of 1.000: 1,321 of 1,381        beyond 1%: 60

Values are printed to 0.1 resolution (`334.500`, `77.100`) — about four
significant figures. A 1% difference on a 334.5 mg/kg sodium reading is 3.3,
which is thirty times the printed resolution. So the distinction sits above the
noise floor of the source, and occasionally reaches 9%.

**The two unit populations are different waters, so choosing one is not a
neutral sample.**

    median      mg/kg     mg/l
    TSM           875     1302
    Na            216    282.5
    Cl            154    220.8
    泉温          33.8     45.8

The mg/l rows are hotter and more concentrated. Importing only them would bias
the atlas toward hot brines and quietly under-represent the dilute, cooler
springs that make up most of Japan.

**There is almost nothing to reconcile — one record, corrected 2026-09-08.**
This spec first said the single spring carrying anything in `minerals` held
only a `notes` string. That was wrong: Radium Hot Springs (`whs_ce8611720825`)
publishes five figures from a curated Parks Canada claim — sulfate 302,
bicarbonate 100.8, calcium 135, magnesium 31.6, silica 31.8 — and the original
check simply looked at the wrong keys.

So there is exactly one pre-existing record that states figures without naming
a unit. It cannot be fixed in the same pull request as the field, because a
claim cannot land with the schema it uses; the test names it as a known
exception so that a second one fails loudly.

## The options, with their measured cost

**A — Import only mg/l rows.** Honest units, no new schema. Costs 71% of the
rows *and* biases the sample toward hot brines, per the table above. The bias is
the real objection: a reduced sample is a smaller atlas, a skewed sample is a
misleading one.

**B — Import everything, record the unit in `minerals.notes`.** No schema
change, full yield, technically honest. But `notes` is prose, and two records
would then show `Sodium 216` and `Sodium 282` in fields labelled mg/L while
meaning different things. A number a reader cannot compare to the number beside
it is not doing the job a numeric field exists for.

**C — Import everything, treat mg/kg as mg/L, disclose once in `DATA.md`.**
Full yield, commensurable, one documented caveat. But it writes a unit the
source did not use, the error is above printed resolution, and the disclosure
lives somewhere the reader of a spring card will never be.

**D — Add `minerals.unit` and carry what the source said.** Full yield, honest,
comparable once rendered. Costs a schema field, a UI line, and two pull requests
under the existing rule.

## Recommendation: D

**Not because it is the most careful option, but because this repository has
already answered this exact question twice and both answers were D.**

`temperature.kind` is claimable, in `overlay.mjs`'s own words, "because
without it a source reading and a bathing reading render identically". The
minerals card gives the same reasoning for `measuredAt`: *"chemistry drifts,
and an undated analysis may be decades old."* Both fields exist to stop a
qualifier being dropped just because the number reads fine without it.

A mg/kg figure and a mg/L figure render identically too. The same argument
applies unchanged, and choosing differently here would mean the atlas carries
the qualifier when it is cheap and drops it when it is inconvenient.

Options B and C both end with a card that shows a number under a unit it is not
in. That is the failure `temperature.kind` was built to prevent.

### Shape

One field for the panel, not one per constituent:

```ts
  /**
   * The unit the source printed the panel in. Not normalised, because
   * mg/kg -> mg/L needs the solution density and 74% of the rows that
   * would need it do not publish one. A figure in a unit the source did
   * not use is worse than a figure a reader has to read the unit of.
   */
  unit: 'mg/l' | 'mg/kg' | null;
```

`null` means the source published figures without saying which — 112 rows in
AIST — and is the honest reading of that, exactly as `measuredAt: null` is for
an undated analysis.

Scope notes: **pH is unitless** and unaffected. **Rn carries its own `Rn単位`**
in the source and is outside the standard panel; it belongs in `notes` if it is
imported at all. `tds` is in the same unit as the rest of the panel, so the
existing "mg/L" in its comment becomes "the unit named by `minerals.unit`".

### Sequencing

Two pull requests, per the standing rule that a schema addition and its first
use cannot land together:

1. Add `minerals.unit` to `types.ts` and `CLAIMABLE`, render it on the minerals
   card, default `null` everywhere. No data changes.
2. The first source that writes chemistry sets it.

The provenance lesson from `SourceProvider` applies here too: `tsc` never sees
the shipped payload, so a test must assert that any record with a numeric panel
value also carries a `unit`, or the field will drift into decoration.

## What this means for AIST

AIST enrichment is deferred, and this does not un-defer it. But it removes the
blocker: when it resumes, chemistry is importable at full yield without a
conversion, a relabelling, or a biased subsample. The remaining AIST questions
are unchanged — the ~20-match name standard, and whether the apparatus is worth
building for that.

## What is deliberately not decided here

Whether to import AIST chemistry at all. Whether `minerals.potassium` is added
(it is in 6,842 AIST rows and absent from the schema). The `泉質` →
`MineralType` lookup. All three are downstream of this and none is blocked by
it.
