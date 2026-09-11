# The Water Quality Portal as a fourth upstream — the US, measured

Written 2026-09-11. Status: recommendation, awaiting two decisions. No code.

The United States is the largest gap in the atlas: **1,752 springs with no
temperature**, of which **1,391 are unnamed** and **1,683 cite nothing but
OSM**. Every per-page approach has now been measured and failed — 80 US
operator pages produced one figure, and that one is a range shape.

NCEI's 1981 list is already imported and gave what it had: 1,023 new pins and
131 enrichments. This spec asks whether the **Water Quality Portal** — the
joint USGS / EPA / NWQMC service that superseded NWIS water-quality — is the
next bulk upstream, and what it would cost.

Two decisions are needed. One of them changes a posture this repository has
held since the first upstream.

## What it is

    service    https://www.waterqualitydata.us/data/{Station,Result}/search
    filters    siteType=Spring & characteristicName=Temperature, water
    licence    US federal, public domain; attribution to USGS/EPA expected
    format     CSV, RFC4180-quoted

Two endpoints: `Station` gives a monitoring location and its coordinates,
`Result` gives the readings. Both are needed; neither alone is usable.

## Measured, not estimated — the Nevada pilot

Nevada was taken end to end, being the densest hot-spring state in the
country.

    WQP spring stations in NV with a temperature   1,339
    temperature results across them                2,329
    ...of which below 20 C                         1,597

**The source is mostly cold springs, and that turns out not to matter.**
`siteType=Spring` is every spring USGS monitors, and the great majority are
cold. But the atlas only ever asks about locations it already calls a hot
spring, and at those locations the readings are hot:

    NV atlas springs with no temperature                   261
    ...with a WQP spring station within 200 m               72   (28%)
         hottest reading >= 25 C                            69
         hottest reading < 25 C                              3
         MORE than one station in range (contended)         21
         exactly one station                                 51
             its readings agree within 2 C  -> PUBLISH      43
             its readings disagree          -> withhold      8

**43 of 261, or 16% of the state's gap.** Applied to the 1,710 gap springs in
the lower-48 west that would be roughly **270 springs** — the largest single
increment available to this project, about five times every country batch of
2026-09-08/09 combined.

That extrapolation is the weakest number here and should be read as a range,
not a figure. Nevada is the most heavily monitored hot-spring state in the
US; 150 is as plausible as 270.

## The contention case, and why it decides the rule

**Great Boiling Spring** has **17 WQP stations within 200 m** of one atlas
record, carrying 18 readings **from 0 °C to 100 °C**.

That is not noise. It is a spring *field*: many vents, plus what are almost
certainly ambient and runoff measurements. Taking the maximum publishes
100 °C; taking the minimum publishes 0 °C; averaging publishes a number
nobody measured. All three are wrong about the pin.

So the rule is the one `ncei-match.mjs` already uses, unchanged: **more than
one station in range is contention, and contention withholds.** That costs 21
of Nevada's 72 matches and it is the right trade — this is the NOAA
group-versus-vent problem again, and under-importing is the error this project
prefers.

**Repeated readings at a single station are a different question** and need
their own answer. A spring measured six times between 1961 and 2004 has a
spread. This is not the AIST case of different wells; it is the same point
measured repeatedly.

Recommendation: **publish only when the readings agree within 2 °C, and
publish the most recent of them.** Not the mean, which is computed; not the
maximum, which is cherry-picking in the direction that flatters a hot-spring
atlas. Where they disagree by more than 2 °C, the spring genuinely varies and
one number would misrepresent it — withhold and report. That costs 8 of
Nevada's 51.

## The three cold matches

Three NV springs OSM calls hot have a nearest reading below 25 °C. The rule
above does not special-case them, and should not: USGS measured what it
measured, and a spring the atlas calls hot which reads 22 °C is either
mis-tagged in OSM or genuinely tepid. Publishing the measured figure is the
honest act, and `suspect.json` already exists for the mis-tag case.

**Not proposed:** a floor that drops cold readings. That would make the
upstream flatter the atlas by construction, and it is exactly the
cherry-picking the maximum rule above rejects.

## Decision 1 — the pin, and a posture change

This is the one that matters.

NCEI and AIST are both **static archives pinned by sha256**. The fetcher
verifies the bytes, and the mirror is regenerated deterministically from them,
so `data:build` is reproducible from an input whose identity is proven.

**WQP has no archive. It is a query.** Re-running the same request next month
returns more rows, because USGS keeps measuring. There is nothing to hash.

Three options:

**A — mirror the CSV as a dated snapshot, and pin the MIRROR.** The committed
file carries its fetch date and its own sha256. The build stays fully
deterministic from the mirror; the *fetch* is explicitly not reproducible, and
the header says so. Git becomes the version control the upstream does not
provide.

**B — fetch at build time.** Rejected outright. It makes `data:build` require
the network, non-deterministic, and dependent on a service that takes 60
seconds to answer.

**C — do not import.** Keep the pin discipline absolute and leave the US gap
where it is.

**Recommend A**, and state the change plainly in the header and in DATA.md
rather than letting it pass as though nothing moved: *this upstream is a
snapshot, not a pinned derivation.* What the pin protects — that a build is
reproducible from committed inputs — is preserved. What it cannot protect is
that a re-fetch reproduces the snapshot, and no discipline on our side can
change that about a live service.

## Decision 2 — is the fetch worth it

The API answers in **roughly 60 seconds per query regardless of scope** — a
bounding box returning 5 stations takes as long as a state returning 1,339.
Latency is fixed, not proportional.

    by state       ~20 states x 2 queries x 60-300s   =  1 to 2 hours
    by 2-deg tile  83 tiles x 2 queries x 60s         =  ~2.8 hours

Either way this is a **one-off, out-of-band fetch**, not something that runs
in a session or in CI. `scripts/fetch-wqp.mjs` would be run once by the
maintainer, write the mirror, and the mirror is what ships.

That is not a reason against it — `fetch-osm.mjs` is also long — but it should
be chosen deliberately rather than discovered halfway through.

## What ships, if both decisions go yes

- `temperature.celsius` from the most recent agreeing reading
- `temperature.kind: 'source'` — WQP measures at the monitoring location,
  which for a spring site is the spring
- `temperature.measuredAt` the reading's own date, which is per-record and
  real, unlike NOAA's uniform 1981
- `temperature.source` citing USGS/EPA WQP and the station identifier
- `quality.provenance` gains `wqp`
- A match report naming every withheld spring and why — contended, disagreeing
  or unmatched
- Attribution in DATA.md

**Enrichment only.** No pins are minted. WQP stations are monitoring points,
not visitor destinations, and the 1,339 Nevada stations are overwhelmingly
cold springs nobody would want in a hot-spring atlas. Admission would be a
separate decision with a separate argument, and this spec does not make it.

## What is deliberately not decided

Whether WQP's chemistry (pH, conductance, dissolved solids) should follow —
it is available under the same query shape and would reuse `minerals.unit`,
but it is a second import with its own contention questions. Whether the
Alaska gap (23 springs) justifies its own fetch. Whether a state-level
prioritisation beats a national one, given that 96% of US records carry no
`location.region` and the state has to be derived from coordinates anyway.
