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
import { DEFAULT_ORIGIN } from './build-sitemap.mjs';
import { UPSTREAMS, COLLECTION_LICENCE } from './lib/sources.mjs';
import { TITLE, SITE_ORIGIN, REPO_URL, CREATORS, KEYWORDS } from '../src/lib/citation.ts';

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
  const sitemap = fs.readFileSync('public/sitemap.xml', 'utf8');
  assert.ok(sitemap.includes(`<loc>${SITE_ORIGIN}/</loc>`), 'sitemap.xml was built for another origin');

  // And the page reads the repository and publisher from the same module.
  const footer = fs.readFileSync('src/components/AtlasFooter.tsx', 'utf8');
  assert.match(footer, /import \{ REPO_URL \} from '\.\.\/lib\/citation\.ts'/);
  assert.match(footer, /href=\{REPO_URL\}/);
  assert.ok(!footer.includes('github.com/'), 'AtlasFooter restates the repository URL');
  const seo = fs.readFileSync('src/lib/seo.ts', 'utf8');
  assert.match(seo, /from '\.\/citation\.ts'/);
  assert.ok(!seo.includes('World Hot Springs contributors'), 'seo.ts restates a creator');
});
