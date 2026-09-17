/**
 * Who publishes this atlas, where it lives, and how to cite it.
 *
 * ONE definition. The page footer, the Dataset JSON-LD, CITATION.cff and
 * .zenodo.json all read these values, and the last two are generated from
 * this file by `scripts/build-citation.mjs` rather than typed a second time.
 * Before this file the repository URL was a literal in the footer, the
 * creator was "World Hot Springs contributors" in two places, and the site
 * origin was written in three -- which is the second-copy-of-a-fact defect
 * this project has already paid for three times, now in the metadata an
 * archive freezes for good.
 *
 * A leaf module with no imports, and erasable syntax only, so that Node can
 * load it directly by stripping types (the way `scripts/card-model.test.mjs`
 * loads `format.ts`) and the generator needs no build step.
 *
 * Nothing here is a count. The description is timeless on purpose: the
 * generator appends the numbers from `data/summary.json`, so a record added
 * next month cannot leave a stale figure in a sentence nobody re-reads.
 */

export const TITLE = 'World Hot Springs';

/** The canonical origin. `scripts/build-sitemap.mjs` and `public/robots.txt` are tested against it. */
export const SITE_ORIGIN = 'https://whs.boring.energy';

export const REPO_URL = 'https://github.com/BoringEnergy/world-hot-springs';

/** The publisher's own site, linked from the masthead and named in CITATION.cff. */
export const PUBLISHER_URL = 'https://hudsonrnd.com';

export const KEYWORDS: readonly string[] = [
  'hot springs',
  'thermal springs',
  'geothermal',
  'geospatial',
  'open data',
  'OpenStreetMap',
];

export const DESCRIPTION =
  "An open, curated, provenance-attached atlas of the world's public and semi-public hot springs. " +
  'Temperature, price, clothing policy and opening hours are first-class fields; unknown values are ' +
  'stored explicitly as null and rendered as "Unknown" rather than omitted, blank, or invented. ' +
  'Springs that local communities ask to have excluded are removed from the live atlas and from every ' +
  'later version, and the exclusion survives re-import.';

export interface Creator {
  name: string;
}

/**
 * The entity that publishes the dataset, not the people who wrote it. A
 * decision, made 2026-09-16: an archived DOI record is permanent, and a
 * personal name in it is the one thing that could never be taken back.
 *
 * Name only, because it is copied verbatim into .zenodo.json and Zenodo's
 * creator schema has no field for a website. CITATION.cff adds
 * PUBLISHER_URL itself.
 */
export const CREATORS: readonly Creator[] = [{ name: 'Hudson R&D' }];

/**
 * The concept DOI: the one that always resolves to the latest version.
 * Wired on purpose, after the v1.0.0 record had been read back
 * from Zenodo (see docs/RELEASING.md). It was `null` until then, because a
 * placeholder DOI in a citation file is an invented identifier.
 *
 * Only the concept DOI is written anywhere. Each version also gets a DOI of
 * its own (v1.0.0's is 10.5281/zenodo.22800997), but that one is minted when
 * the release is published, so the files a release archives cannot know it.
 * A reader who needs the exact version finds its DOI on the Zenodo page.
 */
export const CONCEPT_DOI = '10.5281/zenodo.22800996';

/** The concept DOI as a link. Everything that links the DOI builds it from here. */
export const DOI_URL = `https://doi.org/${CONCEPT_DOI}`;

/**
 * The plain-text citation the README and the About panel print. No year and
 * no version: the concept DOI spans every version, and a hand-typed year is
 * the first thing to go stale. Written from the facts above, so a new creator
 * or title changes it everywhere at once.
 */
export const RECOMMENDED_CITATION =
  `${CREATORS.map((c) => c.name).join('; ')}. ${TITLE} [Data set]. Zenodo. ${DOI_URL}`;
