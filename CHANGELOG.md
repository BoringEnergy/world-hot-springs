# Changelog

This is the changelog of the **dataset** -- `data/hot-springs.json`,
`data/hot-springs.geojson` and `data/summary.json` -- because the dataset is
what gets cited. The site and the pipeline change far more often than the
data does, and a version number that moved every time a button did would say
nothing to someone asking whether the records they cited are still the
records.

## Versioning

    MAJOR   a schema break. A field renamed, removed or retyped, so code that
            read the previous version can misread this one
    MINOR   records or fields added or removed
    PATCH   corrections to existing records, with no change of shape

Every released version is a git tag `vX.Y.Z` and an archived, immutable
snapshot with its own DOI. How a release is made is in
[docs/RELEASING.md](docs/RELEASING.md).

The top dated entry below is read by `scripts/build-citation.mjs`: its
version and date become `version` and `publication_date` in `.zenodo.json`
and `version` and `date-released` in `CITATION.cff`, and a test holds
`package.json` to the same version. Change them here and nowhere else.

## [1.0.0] - 2026-09-16

The first citable snapshot. Its size is stated in the archived record's
description, which is generated from `data/summary.json`, and its upstreams
and their licences are listed in DATA.md -- neither is restated here, so
neither can drift.

The published data is **byte-identical** to the v1 declaration of
2026-09-11 (commit `0a72527`). Nothing about the records changed between v1
being declared and v1 being archived; what changed was the site around
them.

- Every record has a permanent address, `https://whs.boring.energy/s/<id>`.
- Temperature, price, clothing policy and opening hours are first-class
  fields, and an unknown value is stored as `null` rather than omitted or
  invented.
- Coordinates state their precision where a source gives one
  (`location.accuracyMeters`).
- Every upstream's licence and attribution travel with the data, in
  `metadata.sources`.
