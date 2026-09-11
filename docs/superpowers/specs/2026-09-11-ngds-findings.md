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
