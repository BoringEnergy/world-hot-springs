# NGDS: alive, but the value is admission rather than enrichment

Written 2026-09-11. Status: findings and a recommendation. No code.

Investigated as the next US lead after the Water Quality Portal. The headline
is that **NGDS looks dead and is not**, and that what it offers is not what
the handoff assumed.

## It looks decommissioned, and that is a trap

    geothermaldata.org                    returns an empty page
    gdr.openei.org CKAN API               404 on every path
    ScienceBase "AASG State Geothermal"   2 records, one of them unrelated

The one surviving AASG record on ScienceBase — *Montana Thermal Springs* —
carries a distribution link that returns `{"error":{"code":404,"message":
"Service not found"}}`. At that point the reasonable conclusion is that the
National Geothermal Data System is gone.

**It is not gone. The link has the wrong case.** ScienceBase points at
`/services/MT_data/MTThermalSprings`; the folder is `MT_Data`. With the
capital D the service answers immediately, and the whole NBMG service
directory is live:

    CO_Data  ID_Data  MT_Data  NV_Data  SD_Data  UT_Data  WY_Data
    FORGE  GBCGE_Subsurface_Data_Exchange_Models  Qfaults  ...

Worth recording for its own sake: a one-character case difference in a
federal catalogue's own link made a live national dataset look retired.

## What is actually there

AASG's `ThermalSpring` content model, four states:

    MT  MTThermalSprings        97
    ID  IDThermalSprings1_8    404
    CO  COThermalSprings1_8    390
    UT  UTThermalSprings       285
                             -----
                             1,176   of which 1,106 state Celsius

The schema is better than NOAA's. Every feature carries `Temperature`,
`TemperatureUnits`, **`TempMeasurementProcedure`** ("Thermometer", "Field spot
measurement", "Unspecified instrumentation") and **`TempMeasurementDateTime`**
— a per-record date and method, where NCEI gives a uniform 1981 and no method
at all.

**Two gaps matter.** `WYThermalSprings1_8` is published with **no layers** —
an empty service. And **Nevada has no thermal-springs service at all**, which
is the single biggest hot-spring state in the country.

## Enrichment yield: 19. Not worth building.

Against the 1,712 US springs with no temperature, applying the same two
contention rules the WQP matcher uses:

    with an NGDS spring within 200 m          55
      several in range (contended)            21
      exactly one                             34
        and that spring is unshared           19   <-- would publish
          of which below 25 C                 14

Nineteen springs does not justify a fourth fetcher, a matcher and their tests.

## Why it is so low, and where the value actually is

    NGDS springs stating Celsius                                 1,106
      within 200 m of an atlas spring that ALREADY has a temp      394
      within 200 m of one that does not                             94
      matching no atlas spring at all                              618

**36% is corroboration of what NCEI, WQP and OSM already gave**, and 56% is
at locations this atlas does not hold. The enrichment seam is small because
these are largely springs OpenStreetMap never mapped.

Those 618 are the finding. Run through the **existing** `ncei-admit.mjs`
rules, unchanged:

    orphans                                        618
      named                                        598
      coordinates at 3 dp or finer                 618  (all of them)
      inside a no-bathing boundary                   3
      generic or absent name                        26
      WOULD PASS ADMISSION                         589

    temperature bands: <25C 199 | 25-49C 281 | 50-79C 125 | 80C+ 13

589 new pins, every one with a temperature, a measurement method and a date.
For scale, NCEI stage two admitted 1,023.

## Recommendation

**Do not build NGDS as an enrichment upstream.** Nineteen springs is the
wrong trade.

**The decision worth making is admission**, and it is the NCEI stage-two
decision again with better metadata and a smaller footprint. It needs the same
argument NCEI's did — these become pins a reader can click and drive to — so
it is a product change, not a data change, and it should not be smuggled in
as one.

Three things to weigh before saying yes:

1. **199 of 618 are below 25 C.** AASG's own content model calls them thermal
   springs, and this atlas already publishes cold ones where a source states
   the figure (Fischauer 19 C, Lons-le-Saunier 17 C, 静内温泉 11 C). Defensible,
   but it would move the atlas's centre of gravity.
2. **Four states only.** Montana, Idaho, Colorado, Utah. Nevada — the biggest
   gap — is absent, so this does not close the US.
3. **The privacy filter still runs last**, as it must. Nothing here changes
   that, and admission's placement above `dedupe()` is already solved.

## Unexplored, and the better Nevada lead

`NV_Data/NVaqSpringChemistry` is live, has **ten layers**, and its first alone
holds 1,338 features carrying `FluidTemperature_C` alongside `LatDegree` /
`LongDegree`. Nevada has no thermal-springs layer but it does have this.

It is a chemistry database rather than a gazetteer, so it likely overlaps
heavily with the Water Quality Portal — both descend from USGS and NBMG
sampling. Worth measuring before assuming either way, and it is the obvious
next probe if the US is pursued further.

`UTaqSpringChemistry` and `COaqSpringChemistry` exist on the same pattern and
would also feed `minerals.*`, which is a separate question from temperature.

---

# Decision, 2026-09-11: enrichment closed, admission not authorised

Recorded after review. Both halves were declined, for different reasons, and
the second one came with a measurement this spec should have made first.

## Enrichment — closed

Nineteen springs after both contention rules is the wrong trade for a fourth
fetcher. **`ngds-match.mjs` is not to be built.** And 36% of NGDS's Celsius
rows sit on pins that already carry a temperature from NCEI, WQP or OSM —
that is corroboration, not a gap.

## Why "589 would pass `ncei-admit`" was never an authorisation

Those rules answer *is this row named, precise, soak-class by name, and
outside a no-bathing park?* They do not answer *should this atlas grow by
four states' thermal inventories.*

NCEI stage two already made that product change once — ~1,023 NOAA-only pins,
each carrying a historical warning and marked unverified. Doing it again needs
a reason better than "the classifier would let them through". Presenting a
classifier pass rate as if it were a product argument was the error in the
section above, and it is worth naming as one.

### 1. The 199 below 25 C decide it

The atlas already prints a cold figure when a source measured one **on a place
it already called a spring** — Fischauer 19 C, Lons-le-Saunier 17 C, 静内温泉
11 C. That is enrichment honesty.

**Minting 199 new pins whose only claim to be here is AASG's "thermal spring"
label is a different act.** It shifts what a zoomed-out western map *is*: from
soak destinations toward a geothermal inventory with a globe on top — which is
precisely what Decision 1 of NCEI stage two refused when it kept fumaroles
out.

AASG's content model is broader than this product. Better metadata (method and
date) makes a better card; it does not make a 17 C monitoring point a public
hot spring.

**If admission is ever opened, new pins need a temperature floor. Existing
pins do not.** 25 C is the floor to use; 20 C is NOAA's own thermal cutoff if
one source's definition is preferred to two. Either way the excluded rows stay
in the report as `aasg-thermal / atlas-cold`, not on the map.

That cut is **not** the WQP "no floor" rule contradicting itself. WQP attached
a number to a pin OSM had already named hot. This would be creating the pin.

### 2. Four states, and not the one that matters

MT + ID + CO + UT. Wyoming's service is empty; Nevada has no `ThermalSpring`
layer at all, and NCEI stage two already put 191 Nevada pins on the map.

A 16% atlas-wide jump that misses the densest hot-spring state is not
"finishing America". It is another partial inventory, and it fattens the
states that already have the most federal coverage.

### 3. Privacy-last and placement above dedupe are not reasons to say yes

The machinery exists and is correct. Machinery is not product intent, and
listing it as a supporting point was padding.

## The measurement that was missing — and it changes the number

The section above compared NGDS to the atlas at 200 m. **It never compared the
618 orphans to the pins NCEI stage two already minted.** Some are genuine
holes; some are the same spring field 300–2,000 m from an NCEI pin, which is
group-versus-vent again, and 200 m calls those unmatched.

Measured now, brute force over all 618 x 1,023 pairs:

    distance from each orphan to the nearest NCEI-minted pin
      band            all    >=25C
      200-500 m       148      123
      500-1000 m       60       48
      1000-2000 m      47       35
      2000-5000 m      46       36
      >5 km           317      177
      TOTAL           618

**255 of 618 — 41% — sit within 2 km of a pin NCEI already minted, and 148 of
them within 500 m.** At 500 m in a spring field, that is the same feature
NOAA already listed.

    by state   orphans  >=25C  within 2 km of NCEI  NCEI pins there
      UT           210     78                   69               88
      ID           201    161                   93              162
      CO           194    170                   86               32
      MT            13     10                    7               48

Colorado is the one genuine hole: 194 orphans against 32 NCEI pins. Idaho is
the opposite — 201 orphans against 162 pins, 93 of them within 2 km.

### What survives the two conditions

    orphans                                      618
    ...with a 25 C floor                         419
    ...and 2 km or more from any NCEI pin        213
    ...with a 20 C floor instead of 25           339
    ...25 C floor and 5 km from any NCEI pin     177

**589 becomes 213.** The figure that was offered as the prize was inflated
about 2.8x by rows that are cold, already-listed, or both.

## Where this leaves NGDS

Nothing is authorised. Enrichment is closed permanently. Admission is not
refused forever, but it now has a stated shape: **a temperature floor, a
minimum distance from existing pins, and a reason that is about the product
rather than about a classifier.** At 213 springs across three states, with
Nevada absent, that reason has not been made.

The Nevada lead below (`NVaqSpringChemistry`, 1,338 features carrying
`FluidTemperature_C`) remains the more interesting probe, and is untouched by
this decision.
