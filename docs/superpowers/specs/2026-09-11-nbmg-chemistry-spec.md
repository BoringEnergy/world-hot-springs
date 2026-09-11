# NBMG spring chemistry as a fifth upstream — Nevada and Colorado

Written 2026-09-11. Status: recommendation, awaiting a decision. No code.

Follows the findings in
[2026-09-11-nbmg-chemistry-findings.md](2026-09-11-nbmg-chemistry-findings.md),
which established that this source is worthless for temperature and is the
best chemistry source the project has found for the United States. This spec
settles the four things that review left open.

## What ships

**109 springs gain a mineral panel. Nevada 96, Colorado 13.**

    US springs with no chemistry                    2,849
      with a chemistry site within 200 m              306
        several sites in range (contended)            134
        exactly one, and unshared                     123
          at least one field whose readings agree     109   <-- publish

    fields: potassium 85, magnesium 78, chloride 68, calcium 66,
            sodium 63, silica 61, bicarbonate 59, sulfate 58,
            pH 57, iron 54

For scale: the atlas carries chemistry on **65 springs worldwide today** —
one curated Radium claim and 64 from AIST — and on **zero of 2,849 American
ones.** This roughly triples it.

**Temperature is explicitly not taken from this source.** It yields 12 springs
and is closed; see the findings. A future pass should not reopen it because
the chemistry stage happens to be reading the same rows.

## Scope

    NV  NVaqSpringChemistry   10 layers   1,136 sites with a panel value
    CO  COaqSpringChemistry    8 layers     140 sites
    UT  UTaqSpringChemistry    ZERO LAYERS -- published and empty

Colorado is worth including for 13 springs only because it costs one more
service in the same fetcher. Utah's empty service is the same pattern as
`WYThermalSprings1_8`; expect it on this server rather than rediscovering it.

## Decision 1 — the column mapping, audited rather than guessed

Two of ten mappings were wrong on the first attempt, so this is stated as a
table and must be tested against the real mirror.

| field | column | layer | rows with a value |
|---|---|---|---|
| `ph` | `ph_Field`, else `ph_Lab` | WaterQuality | 1,048 / 978 |
| `calcium` | `Ca_mgL` | Common, Major | 1,678 |
| `magnesium` | `Mg_mgL` | Major | 1,638 |
| `sodium` | `Na_mgL` | Common, Major | 1,540 |
| `potassium` | `K_mgL` | Common, Major | 1,476 |
| `silica` | `SiO2_mgL` | Common, Major | 1,532 |
| `chloride` | `Cl_mgL` | Common, Major | 1,782 |
| `sulfate` | `SO4_mgL` | Common, Major | 1,650 |
| `bicarbonate` | `Bicarbonate_mgL` | CommonAnalytes | 1,045 |
| `iron` | `FeTot_mgL` | CommonAnalytes | 1,438 |
| `tds` | — | — | **not available** |

Three of those rows are judgements rather than lookups:

**`Alkalinity_mgL` is NOT bicarbonate.** Alkalinity is reported as CaCO3
equivalent and is a different quantity. The first cut mapped it and would have
published a wrong figure on a rendered panel. `Bicarbonate_mgL` is the real
column, and it also has far more values — 1,045 against 137.

**`FeTot_mgL`, not `Fe_mgL`.** Total iron rather than dissolved. This is the
same choice the AIST import already made — it reads `TFe` — and holding two
upstreams to one definition of "iron" matters more than the extra 376 rows
`FeTot_mgL` happens to carry.

**`ph_Field` before `ph_Lab`.** A pH measured at the spring beats one measured
after the sample travelled; carbonate chemistry shifts on the way to a lab.
Both are present, and the field value is preferred where it exists.

### `tds` is unavailable, and this is why it is written down

`TotalDissolvedSolids_mgL` exists in two layers and is **null in all 3,683
rows.** The column is published and never populated.

This was recorded as "unexplained" in the findings, which was the right place
to stop and the wrong thing to ship. An empty column and an absent column are
indistinguishable from a mapping that returns nothing, and the difference is
the whole question of whether the mapping is broken.

## Decision 2 — per-field agreement, using AIST's tolerances

A site may carry several analyses of the same spring taken years apart. The
rule is AIST's, unchanged: **publish a field only when every reading of it
agrees within tolerance, and never average.**

    ph                                        0.1
    iron                                      0.1
    everything else in the panel              1.0   (mg/L)

The findings used 5% as a placeholder. Measured against the real data, the
absolute tolerances are **stricter**, not looser: Nevada's yield falls from
100 to 96, because 5% of a 2,000 mg/L chloride reading is 100 mg/L of slack
and 1 mg/L is not. Stricter is the right direction, and the drop is the
evidence that the placeholder was too generous rather than too mean.

## Decision 3 — contention, in both directions

The rule that the WQP import got wrong first time and that cost it 142 matches
down to 40. Both directions, from the start:

- **Several chemistry sites within 200 m of one spring** → publish nothing.
  134 springs here.
- **One site within 200 m of several springs** → publish nothing for any of
  them. Copying one analysis onto two pins asserts two facts from one sample.

A claimed field always wins, as with every other upstream, and a field the
atlas already holds is never overwritten.

## Decision 4 — the pin

Same problem and same answer as the Water Quality Portal. This is an ArcGIS
query service with no published archive, so **the mirror is the pinned
artefact**: it carries its fetch date and its own sha256, `data:build` stays
deterministic from it, and the header says that nothing reproduces the fetch.

Unlike WQP this fetch is fast — the service answers in seconds, and the whole
of Nevada and Colorado is eight queries — so it needs no tile grid and no
resumability.

## Units, and the question that does not arise

Every column names its unit: `_mgL`. So `minerals.unit` is `mg/l` for every
record this writes, with no conversion and no density. The AIST import needed
a whole spec to decide what to do about mg/kg; here the source settles it.

`-99999` is the null sentinel throughout, and read as a number it would
publish a figure no water has.

## What is deliberately not decided

Whether temperature should ever be taken from this source — it is closed at 12
springs, not deferred. Whether `minerals.types` can be derived from these
analyses; it would be a computed classification, which rule 2 forbids for the
same reason the 泉質 spec was careful. Whether the other NBMG layers
(`BaseMetals`, `WaterIsotopes`, `GasIsotopes`) have any place here — they are
outside the standard panel and belong in `notes` if anywhere. Whether Colorado
alone justifies a second service if Nevada were ever dropped.
