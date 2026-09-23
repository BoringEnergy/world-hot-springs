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
    PATCH   corrections to existing records, with no change of shape, or
            to the documents that travel with them (the README, LICENSE,
            DATA.md, CITATION.cff and the archive's own metadata)

Every released version is a git tag `vX.Y.Z` and an archived, immutable
snapshot with its own DOI. How a release is made is in
[docs/RELEASING.md](docs/RELEASING.md).

The top dated entry below is read by `scripts/build-citation.mjs`: its
version and date become `version` and `publication_date` in `.zenodo.json`
and `version` and `date-released` in `CITATION.cff`, and a test holds
`package.json` to the same version. Change them here and nowhere else.

## [Unreleased]

- **343 records that are not hot springs are quarantined.** 7,490 springs
  across 131 countries become 7,147 across 126. A review of every
  attribute-free record whose name says nothing thermal found the same
  failure the list already caught in Iraq, Syria, Yemen and Libya, in more
  places: a Casablanca supplier's customer register (`C3005333 …`), village
  and household water surveys in Thailand, irrigation points in Tajikistan,
  every record in Palestine, Lebanon, Sudan and Mauritania, most of Egypt,
  Oman and Ukraine, and 43 single features, from an airport to a radiator
  shop. Each entry in
  `data/known-bad-imports.json` gives its evidence and what it keeps.
  Quarantined records stay in `data/suspect.json` and each one is logged
  as `spring.disappeared`; nothing is deleted.
- **The reviewed list can now say where and what, not only which country.**
  An entry may be confined to a bounding box, match a name pattern, or list
  individual elements, and may except a reviewed genuine spring. A
  country-wide rule was only right where no genuine attribute-free spring
  exists; Thailand, Morocco and Ukraine all have some.

## [1.0.1] - 2026-09-17

The same records as 1.0.0, byte for byte -- nothing under `data/` changed.
This version exists because 1.0.0 was archived before its archive metadata
and several of its documents were right, and an archived version cannot be
edited afterwards.

- **The archive describes itself correctly.** `.zenodo.json` now travels
  with the release, so the record is typed as a dataset, licensed ODbL 1.0,
  credited to Hudson R&D, and linked to each upstream it derives from.
  1.0.0 was archived as software credited to "World Hot Springs
  contributors".
- **CITATION.cff carries the concept DOI**, which always resolves to the
  latest version. The README has a "How to cite" section.
- **Corrected documents.** The README's United States and rest-of-world
  temperature figures, and its unknown share, are recounted from the data;
  the LICENSE data note names ODbL and defers to DATA.md instead of crediting
  OpenStreetMap alone; docs/DATA.md no longer carries a three-upstream table
  that had gone stale.
- **What removal cannot reach is stated.** PRIVACY.md and the Terms page say
  that an archived version, like git history, cannot be altered, and that
  pending removal requests are cleared before any release.

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
