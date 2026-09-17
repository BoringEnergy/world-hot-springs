/**
 * The metadata an archive freezes.
 *
 * When a release is published, Zenodo reads .zenodo.json and mints a DOI from
 * it, and that record is permanent. A wrong licence there is not a stale
 * README; it is the terms a citable dataset is archived under, for good. So
 * these tests hold the two generated files to their sources, and hold the
 * sources to the facts a release depends on.
 *
 * Without .zenodo.json at all, Zenodo would have archived this ODbL dataset
 * as CC BY 4.0 software, because GitHub reports the repository's licence as
 * NOASSERTION. Most of what follows exists to stop that from coming back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { render, latestRelease } from './build-citation.mjs';
import { DEFAULT_ORIGIN, buildSitemap } from './build-sitemap.mjs';
import { UPSTREAMS, COLLECTION_LICENCE } from './lib/sources.mjs';
import {
  TITLE, SITE_ORIGIN, REPO_URL, PUBLISHER_URL, CREATORS, KEYWORDS, CONCEPT_DOI, DOI_URL, RECOMMENDED_CITATION,
} from '../src/lib/citation.ts';

// Rendered on first use rather than at load: render() throws when
// package.json and CHANGELOG.md disagree, and a throw at load would fail the
// file as a whole instead of the test that names the disagreement.
let cache = null;
const out = () => (cache ??= render());
const zenodo = () => JSON.parse(out().zenodo);
const related = () => zenodo().related_identifiers;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * DataCite's relationType vocabulary (Metadata Schema 4.6), in the
 * lower-camel form Zenodo's .zenodo.json takes. An external controlled list,
 * not a fact of this repository: a relation outside it fails the release.
 */
const DATACITE_RELATIONS = [
  'isCitedBy', 'cites', 'isSupplementTo', 'isSupplementedBy', 'isContinuedBy', 'continues',
  'isDescribedBy', 'describes', 'hasMetadata', 'isMetadataFor', 'hasVersion', 'isVersionOf',
  'isNewVersionOf', 'isPreviousVersionOf', 'isPartOf', 'hasPart', 'isPublishedIn',
  'isReferencedBy', 'references', 'isDocumentedBy', 'documents', 'isCompiledBy', 'compiles',
  'isVariantFormOf', 'isOriginalFormOf', 'isIdenticalTo', 'isReviewedBy', 'reviews',
  'isDerivedFrom', 'isSourceOf', 'isRequiredBy', 'requires', 'isObsoletedBy', 'obsoletes',
  'isCollectedBy', 'collects', 'hasTranslation', 'isTranslationOf',
];

/** The Zenodo resource types these links use. Also external. */
const ZENODO_RESOURCE_TYPES = ['dataset', 'software', 'publication-technicalnote', 'other'];

/**
 * A reader for exactly the YAML this generator writes: `key: "json"`,
 * `key:` opening a list, `  - "json"` or `  - key: "json"` items. Anything
 * else throws, which is the point -- an unquoted scalar is a scalar whose
 * meaning depends on its content.
 */
function readCff(text) {
  const doc = {};
  let list = null;
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    let m;
    if ((m = line.match(/^([a-z-]+):$/))) {
      list = doc[m[1]] = [];
    } else if ((m = line.match(/^([a-z-]+): (.*)$/))) {
      doc[m[1]] = scalar(m[2], line);
      list = null;
    } else if ((m = line.match(/^ {2}- ([a-z-]+): (.*)$/))) {
      list.push({ [m[1]]: scalar(m[2], line) });
    } else if ((m = line.match(/^ {4}([a-z-]+): (.*)$/))) {
      list[list.length - 1][m[1]] = scalar(m[2], line);
    } else if ((m = line.match(/^ {2}- (.*)$/))) {
      list.push(scalar(m[1], line));
    } else {
      throw new Error(`unexpected CITATION.cff line: ${line}`);
    }
  }
  return doc;
}

function scalar(raw, line) {
  assert.ok(raw.startsWith('"'), `CITATION.cff has an unquoted value: ${line}`);
  const value = JSON.parse(raw);
  assert.equal(typeof value, 'string', line);
  return value;
}

test('the committed CITATION.cff and .zenodo.json are what the generator writes', () => {
  // A hand edit to either is a second copy of a fact, in the one file that is
  // archived for good. Regenerate with `npm run release:meta`.
  assert.equal(fs.readFileSync('.zenodo.json', 'utf8'), out().zenodo, '.zenodo.json is stale or hand-edited');
  assert.equal(fs.readFileSync('CITATION.cff', 'utf8'), out().cff, 'CITATION.cff is stale or hand-edited');
});

test('the archive is licensed ODbL, not Zenodo\'s default', () => {
  // `odbl-1.0` is Zenodo's id for ODC-ODbL 1.0. Leaving the key out does not
  // leave the licence blank; it lets Zenodo choose.
  assert.equal(COLLECTION_LICENCE, 'ODbL 1.0');
  assert.equal(zenodo().license, 'odbl-1.0');
  assert.equal(readCff(out().cff).license, 'ODbL-1.0');
  assert.equal(zenodo().access_right, 'open');
});

test('the archive is a dataset, not software', () => {
  assert.equal(zenodo().upload_type, 'dataset');
  assert.equal(readCff(out().cff).type, 'dataset');
});

test('every related identifier is a DataCite relation to an https address', () => {
  assert.ok(related().length > 0);
  for (const r of related()) {
    assert.deepEqual(Object.keys(r).sort(), ['identifier', 'relation', 'resource_type'], JSON.stringify(r));
    assert.ok(DATACITE_RELATIONS.includes(r.relation), `${r.relation} is not a DataCite relation`);
    assert.ok(ZENODO_RESOURCE_TYPES.includes(r.resource_type), `${r.resource_type} is not a Zenodo resource type`);
    assert.match(r.identifier, /^https:\/\/[^\s]+$/, r.identifier);
  }
});

test('the tagged source tree is linked, because supplying the list drops Zenodo\'s own link', () => {
  const tree = `${REPO_URL}/tree/v${zenodo().version}`;
  assert.ok(
    related().some((r) => r.identifier === tree && r.relation === 'isSupplementTo' && r.resource_type === 'software'),
    `no isSupplementTo link to ${tree}`,
  );
  assert.ok(
    related().some((r) => r.identifier === `${REPO_URL}/blob/v${zenodo().version}/DATA.md` && r.relation === 'isDocumentedBy'),
    'the archived version must point at the DATA.md of its own tag',
  );
  assert.ok(
    related().some((r) => r.identifier === SITE_ORIGIN && r.relation === 'isSourceOf'),
    'the archive must say it is the source of the live atlas',
  );
});

test('the archive credits every upstream, and no other', () => {
  // Both directions, as sources.test.mjs does for the GeoJSON. An upstream
  // missing here is a derivation the archive does not admit to.
  const derived = related().filter((r) => r.relation === 'isDerivedFrom').map((r) => r.identifier);
  assert.deepEqual([...derived].sort(), UPSTREAMS.map((u) => u.url).sort());
  for (const r of related().filter((x) => x.relation === 'isDerivedFrom')) assert.equal(r.resource_type, 'dataset');
  for (const u of UPSTREAMS) assert.ok(zenodo().notes.includes(u.attribution), `notes do not credit ${u.provider}`);
});

test('one version and one date, from CHANGELOG.md, and package.json agrees', () => {
  const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
  // Read independently of the generator's parser, so a parser that picked the
  // wrong heading cannot agree with itself.
  const first = changelog.split('\n').find((l) => /^## \[\d/.test(l));
  assert.ok(first, 'CHANGELOG.md has no released entry');
  const [, version, date] = first.match(/^## \[([^\]]+)\] - (\S+)$/);
  assert.deepEqual([latestRelease(changelog).version, latestRelease(changelog).date], [version, date]);

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  assert.equal(pkg.version, version, 'package.json disagrees with CHANGELOG.md');
  assert.equal(lock.version, version, 'package-lock.json disagrees with CHANGELOG.md');

  const committed = JSON.parse(fs.readFileSync('.zenodo.json', 'utf8'));
  assert.equal(committed.version, version);
  assert.equal(committed.publication_date, date);
  const cff = readCff(fs.readFileSync('CITATION.cff', 'utf8'));
  assert.equal(cff.version, version);
  assert.equal(cff['date-released'], date);
});

test('the archive names a creator, and it is the publisher', () => {
  assert.ok(CREATORS.length > 0, 'Zenodo refuses a record with no creators');
  assert.deepEqual(zenodo().creators, CREATORS.map((c) => ({ name: c.name })));
  for (const c of zenodo().creators) assert.ok(c.name.trim(), 'a creator with an empty name');
  const cff = readCff(out().cff);
  assert.deepEqual(cff.authors.map((a) => a.name), CREATORS.map((c) => c.name));
  // The CFF author is an entity, and its website is what tells a reader which
  // Hudson R&D this is. .zenodo.json has no field for it; CITATION.cff does.
  assert.deepEqual(cff.authors.map((a) => a.website), CREATORS.map(() => PUBLISHER_URL));
});

test('the notes carry both licences and the attribution condition', () => {
  // AIST's licence makes attribution a condition, so the sentence saying so is
  // a term of use, not a flourish. Found by the licence text rather than by
  // name, so a second such upstream is covered the day it is added.
  const conditional = UPSTREAMS.filter((u) => /attribution required/i.test(u.licence));
  assert.ok(conditional.some((u) => u.provider === 'aist'), 'AIST is the upstream that requires attribution');
  assert.match(zenodo().notes, /Code is MIT/);
  assert.ok(zenodo().notes.includes(`The dataset is ${COLLECTION_LICENCE}`));
  const cff = readCff(out().cff);
  for (const u of conditional) {
    const sentence = new RegExp(`\\(${esc(u.attribution)}\\) conditions its own licence on attribution`);
    assert.match(zenodo().notes, sentence, `notes drop ${u.provider}'s condition`);
    assert.match(cff.message, sentence, `CITATION.cff drops ${u.provider}'s condition`);
  }
  assert.match(cff.message, /not licensed/);
});

test('every CITATION.cff value is a quoted scalar', () => {
  // readCff throws on an unquoted value. A description that one day contains
  // ": " would otherwise turn a string into a mapping without anyone noticing.
  const cff = readCff(fs.readFileSync('CITATION.cff', 'utf8'));
  assert.equal(cff.title, TITLE);
  assert.equal(cff.url, SITE_ORIGIN);
  assert.equal(cff['repository-code'], REPO_URL);
  assert.deepEqual(cff.keywords, [...KEYWORDS]);
  assert.equal(cff['cff-version'], '1.2.0');
});

test('the site origin is one fact', () => {
  // build-sitemap.mjs keeps a literal so the Vercel build never strips
  // TypeScript; this is what makes that literal a checked copy.
  assert.equal(DEFAULT_ORIGIN, SITE_ORIGIN);
  const robots = fs.readFileSync('public/robots.txt', 'utf8');
  const sitemaps = robots.match(/^Sitemap: .*$/gm) ?? [];
  assert.deepEqual(sitemaps, [`Sitemap: ${SITE_ORIGIN}/sitemap.xml`]);
  // Built in memory: public/sitemap.xml is a gitignored build output, and a
  // test that reads it passes or fails on whatever an earlier build left behind.
  const sitemap = buildSitemap([]);
  assert.ok(sitemap.includes(`<loc>${SITE_ORIGIN}/</loc>`), 'the sitemap is built for another origin');

  // And the page reads the repository and publisher from the same module.
  const footer = fs.readFileSync('src/components/AtlasFooter.tsx', 'utf8');
  assert.match(footer, /import \{ REPO_URL \} from '\.\.\/lib\/citation\.ts'/);
  assert.match(footer, /href=\{REPO_URL\}/);
  assert.ok(!footer.includes('github.com/'), 'AtlasFooter restates the repository URL');
  const seo = fs.readFileSync('src/lib/seo.ts', 'utf8');
  assert.match(seo, /from '\.\/citation\.ts'/);
  assert.ok(!seo.includes('World Hot Springs contributors'), 'seo.ts restates a creator');
});

test('CITATION.cff carries the concept DOI, and only the concept DOI', () => {
  // The version DOI of the release being cut does not exist until the release
  // is published, which is after this file is archived. Any other DOI here is
  // either an older version's or invented.
  assert.match(CONCEPT_DOI, /^10\.5281\/zenodo\.\d+$/);
  assert.equal(DOI_URL, `https://doi.org/${CONCEPT_DOI}`);
  // The generator's output: the first test holds the committed file to it.
  const text = out().cff;
  const cff = readCff(text);
  assert.equal(cff.doi, CONCEPT_DOI, 'CITATION.cff does not name the concept DOI');
  assert.deepEqual(
    (cff.identifiers ?? []).map((i) => [i.type, i.value]),
    [['doi', CONCEPT_DOI]],
    'CITATION.cff identifiers should list the concept DOI and nothing else',
  );
  assert.match(cff.identifiers[0].description, /latest version/);
  const dois = new Set(text.match(/\b10\.\d{4,}\/[^\s"]+/g));
  assert.deepEqual([...dois], [CONCEPT_DOI], 'CITATION.cff names a DOI other than the concept DOI');
  // Zenodo files each new version under the concept by itself, so
  // .zenodo.json names no Zenodo DOI and has no `doi` field. (It does link
  // NCEI's upstream DOI, which is a different registrant.)
  assert.ok(!out().zenodo.includes('10.5281'), '.zenodo.json names a Zenodo DOI');
  assert.ok(!('doi' in zenodo()), '.zenodo.json has a doi field');
});

test('the README says how to cite, with the same DOI and the same words', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.match(readme, /^## How to cite$/m);
  assert.ok(
    readme.includes(`[![DOI](https://zenodo.org/badge/DOI/${CONCEPT_DOI}.svg)](${DOI_URL})`),
    `the README has no DOI badge for ${CONCEPT_DOI}`,
  );
  assert.ok(readme.includes(RECOMMENDED_CITATION), `README should contain: ${RECOMMENDED_CITATION}`);
  for (const c of CREATORS) assert.ok(RECOMMENDED_CITATION.includes(c.name), `the citation drops ${c.name}`);
  const dois = new Set(readme.match(/10\.5281\/zenodo\.\d+/g));
  assert.deepEqual([...dois], [CONCEPT_DOI], 'the README names a Zenodo DOI other than the concept DOI');
  // Near the top: after the headline, before the long prose.
  assert.ok(readme.indexOf('## How to cite') < readme.indexOf('## Prior art, named'), 'How to cite is buried');
  assert.match(readme, /\[CITATION\.cff\]\(CITATION\.cff\)/);
  assert.match(readme, /\[DATA\.md\]\(DATA\.md\)/);
});

test('the DOI is written once, in citation.ts, and the page reads it from there', () => {
  const seo = fs.readFileSync('src/lib/seo.ts', 'utf8');
  assert.match(seo, /import \{[^}]*\bDOI_URL\b[^}]*\} from '\.\/citation\.ts'/);
  assert.match(seo, /identifier: DOI_URL,/);
  assert.match(seo, /sameAs: DOI_URL,/);
  // schema.org `citation` lists the works a dataset cites, not how to cite it.
  assert.ok(!/\bcitation:/.test(seo), 'seo.ts puts the DOI in schema.org citation');
  const about = fs.readFileSync('src/components/AboutPanel.tsx', 'utf8');
  assert.match(about, /import \{[^}]*\bDOI_URL\b[^}]*\} from '\.\.\/lib\/citation\.ts'/);
  assert.match(about, /href=\{DOI_URL\}/);
  // And nothing else the site is built from writes it out: not src/, not the
  // root index.html where static head metadata would naturally go, and not
  // the hand-written files in public/. public/data/ is the dataset itself,
  // whose upstream metadata carries NCEI's DOI (a different registrant), and
  // public/sitemap.xml is generated.
  const inSrc = fs.readdirSync('src', { recursive: true })
    .map((f) => `src/${String(f).replace(/\\/g, '/')}`)
    .filter((f) => /\.(ts|tsx|html|css)$/.test(f));
  const inPublic = fs.readdirSync('public', { recursive: true })
    .map((f) => `public/${String(f).replace(/\\/g, '/')}`)
    .filter((f) => !f.startsWith('public/data/') && f !== 'public/sitemap.xml')
    .filter((f) => fs.statSync(f).isFile());
  const restated = ['index.html', ...inSrc, ...inPublic]
    .filter((f) => fs.readFileSync(f, 'utf8').includes('10.5281'));
  assert.deepEqual(restated, ['src/lib/citation.ts'], 'a file other than citation.ts writes a Zenodo DOI into the site');
});
