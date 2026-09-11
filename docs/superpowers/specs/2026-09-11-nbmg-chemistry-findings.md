# NBMG spring chemistry: dead as a temperature source, alive as a chemistry one

Written 2026-09-11. Status: findings and a recommendation. No code.

Probed as the last US lead. `NV_Data/NVaqSpringChemistry` on the same NBMG
server that turned out to be hosting live NGDS services.

The short version: **it is worthless for temperature and it is the best
chemistry source this project has found for the United States.** Those are
different answers and the second one is the recommendation.

## Temperature: 12 springs. Closed.

Same measurement as NGDS, same two contention rules:

    US gap springs with a chemistry site within 200 m   130
      several sites in range (contended)                 71
      exactly one, unshared                              15
        readings agree within 2 C                        12

Twelve. Below NGDS's nineteen, which was already refused. **Do not build this
as a temperature upstream.** The reason is the same one the Water Quality
Portal already demonstrated: USGS and NBMG sample the same Nevada springs, so
410 of these 1,178 positions have a WQP station within 200 m and most of the
rest sit on pins that already carry a figure.

## Chemistry: 100 springs, against a worldwide total of 65

This is the finding.

    atlas springs carrying ANY chemistry today      65 of 7,490
      Radium Hot Springs, curated                    1
      AIST Japan                                    64
    US springs carrying any chemistry            0 of 2,849

**Every American spring in this atlas has an empty minerals card.** The field
exists, renders, has a vocabulary, a unit and a disclaimer, and holds nothing
for the entire United States.

Measured against it, with the same contention rules and a per-field agreement
rule of 5% or 0.1 for pH:

    US springs with no chemistry, with a site within 200 m   252
      several sites (contended)                              119
      exactly one, unshared                                  101
        with at least one agreeing field                     100   <-- publish

    fields: potassium 78, magnesium 71, chloride 66, sodium 66,
            bicarbonate 65, calcium 64, iron 63, sulfate 61,
            silica 58, pH 54

**One hundred springs would more than double the atlas's chemistry coverage**,
and would take the United States from zero.

Units are `mg/L` in every column name, so `minerals.unit` is `mg/l` without a
conversion — the question the AIST import had to spend a whole spec on does
not arise here.

## Why this is the safe shape, unlike NGDS admission

This is **enrichment on pins that already exist**. It mints nothing, moves
nothing, and does not touch the question that stopped the NGDS import —
whether the atlas should grow by somebody else's inventory. A spring that is
already on the map gains a panel describing the water in it.

It is also the field a bather actually acts on. Sulfur, chloride, pH: what the
water smells like, what it does to skin, whether to keep silver out of it.

## Two mapping errors, caught before they reached a number

Recorded because both would have published a wrong figure silently, and
neither would have failed loudly.

**`Alkalinity_mgL` is not bicarbonate.** The first cut mapped it to
`minerals.bicarbonate`. Alkalinity is reported as CaCO3 equivalent and is a
different quantity. `CommonAnalytes` carries a real `Bicarbonate_mgL` column;
using it changed that field's count from 24 to 65 and, more importantly, made
it correct.

**pH is `ph_Field` / `ph_Lab`, lowercase p, and only in `WaterQuality`.** The
first cut looked for `pH` and found nothing, so pH silently reported zero
matches — a field with 54 real values looked like a field the source did not
publish. An absent column and an empty column are indistinguishable unless
the column list is read rather than guessed.

There is also a **`-99999` null sentinel** throughout. Read as a number it
would publish a temperature no spring has.

## Scope, and what it does not cover

    NV  NVaqSpringChemistry   10 layers, 1,095 sites with a panel value
    CO  COaqSpringChemistry    8 layers,   986 features in the panel layers
    UT  UTaqSpringChemistry    ZERO LAYERS -- published and empty

Colorado is a real second source and is unmeasured; its yield is not in the
100 above. Utah's service exists and is empty, exactly as
`WYThermalSprings1_8` was — a pattern on this server worth expecting rather
than rediscovering.

Nothing here covers a state outside NV and CO.

## Recommendation

**Build it, as a chemistry upstream only, Nevada and Colorado.**

The apparatus already exists in the shape this needs: AIST established
contention handling, per-field agreement, `minerals.unit`, and the rule that a
claimed field always wins. This is that stage again with a different reader.

A spec should still settle four things before code:

1. **The per-field agreement tolerance.** 5% was used for the measurement and
   is a guess. AIST used absolute tolerances per field and that is probably
   better.
2. **Which columns map to which field**, written down and tested — given that
   two of ten were wrong on the first attempt.
3. **Whether `TotalDissolvedSolids_mgL` maps to `tds`.** It appears in two
   layers and produced no matches in the measurement, which is unexplained
   and should not be shipped unexplained.
4. **The mirror's pin.** This is an ArcGIS query service, so it has the same
   no-archive problem as WQP and the same answer: snapshot the mirror, pin the
   mirror, say so in its header.
