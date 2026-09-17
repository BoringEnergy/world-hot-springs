/**
 * CITATION.cff and .zenodo.json, generated rather than typed.
 *
 * These two files are what an archive freezes. When a release is published,
 * Zenodo reads `.zenodo.json` and mints a DOI from it, and that record cannot
 * be withdrawn. So the facts in it are not written here at all: the title,
 * creator and origin come from `src/lib/citation.ts`, the upstream credits
 * from `scripts/lib/sources.mjs`, the counts from `data/summary.json`, and the
 * version and date from the top entry of CHANGELOG.md. A test regenerates both
 * files and compares them byte for byte with what is committed.
 *
 * `.zenodo.json` is not optional. GitHub reports this repository's licence as
 * NOASSERTION, and without the file Zenodo would archive an ODbL dataset as
 * CC BY 4.0 software. When the file exists it replaces Zenodo's defaults
 * wholesale, which is also why it has to re-add the link to the tagged tree:
 * supplying `related_identifiers` drops the one Zenodo would have added.
 *
 * CITATION.cff is written from a template, not a YAML library. Every scalar
 * goes through JSON.stringify, and a JSON string is a valid YAML double-quoted
 * scalar, so a description containing `: ` or `#` cannot change the document's
 * shape -- and no dependency is added for one file.
 *
 *   node scripts/build-citation.mjs        (also the tail of `npm run data:build`)
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  TITLE, SITE_ORIGIN, REPO_URL, PUBLISHER_URL, KEYWORDS, DESCRIPTION, CREATORS, CONCEPT_DOI,
} from '../src/lib/citation.ts';
import { UPSTREAMS, COLLECTION_LICENCE, COLLECTION_LICENCE_URL, attributionLine } from './lib/sources.mjs';

export const ZENODO_OUT = '.zenodo.json';
export const CFF_OUT = 'CITATION.cff';

/**
 * Zenodo's licence id and CFF's SPDX id for the collection licence. Keyed by
 * COLLECTION_LICENCE so that changing the licence there without saying what
 * it is called here throws, instead of archiving the old identifier.
 */
const LICENCE_IDS = {
  'ODbL 1.0': { zenodo: 'odbl-1.0', spdx: 'ODbL-1.0' },
};

/** The top dated entry: `## [X.Y.Z] - YYYY-MM-DD`, then everything to the next `## `. */
export function latestRelease(changelog) {
  const m = changelog.match(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (!m) throw new Error('CHANGELOG.md has no dated release entry of the form "## [X.Y.Z] - YYYY-MM-DD"');
  return { version: m[1], date: m[2], body: m[3].trim() };
}

/** Upstreams whose licence makes attribution a condition, not a courtesy. */
export function attributionRequired(upstreams = UPSTREAMS) {
  return upstreams.filter((u) => /attribution required/i.test(u.licence));
}

/** Markdown to plain text, for the fields Zenodo renders as text. */
function plain(markdown) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^- /gm, '* ')
    // Rewrap: a paragraph is one line, a list item is one line.
    .split(/\n{2,}/)
    .map((para) => para.replace(/\n(?!\* )\s*/g, ' '))
    .join('\n\n');
}

/** The timeless description, plus this build's numbers. */
export function abstract(summary) {
  const pct = Math.round((summary.coverage.temperature / summary.total) * 100);
  return (
    `${DESCRIPTION} This version holds ${summary.total.toLocaleString('en-US')} records across ` +
    `${summary.countries} countries; ${pct}% carry a recorded temperature, which is a description of ` +
    'what public data exists rather than a backlog.'
  );
}

/** The sentence every copy of the terms must keep. */
function conditionSentence(upstreams) {
  const required = attributionRequired(upstreams);
  if (required.length === 0) return '';
  const names = required.map((u) => u.attribution).join('; ');
  return (
    ` ${required.length === 1 ? 'One upstream' : `${required.length} upstreams`} (${names}) ` +
    `condition${required.length === 1 ? 's its own licence' : ' their own licences'} on attribution, ` +
    'so a derived work that drops the credit is not licensed.'
  );
}

export function citeMessage(upstreams = UPSTREAMS) {
  return (
    `If you use this dataset, cite it. The dataset is ${COLLECTION_LICENCE} and its share-alike and ` +
    'attribution terms are a condition of use, not a courtesy.' +
    conditionSentence(upstreams) +
    ' See DATA.md for the full upstream list.'
  );
}

export function buildZenodo({ summary, release, upstreams = UPSTREAMS }) {
  const ids = LICENCE_IDS[COLLECTION_LICENCE];
  if (!ids) throw new Error(`no Zenodo/SPDX id recorded for ${COLLECTION_LICENCE}`);
  const tag = `v${release.version}`;

  const notes = [
    `Code is MIT. The dataset is ${COLLECTION_LICENCE} (${COLLECTION_LICENCE_URL}); its share-alike and ` +
      'attribution terms are a condition of use.' +
      conditionSentence(upstreams),
    `Attribution: ${attributionLine()}.`,
    `Every upstream, what it gave and its terms: ${REPO_URL}/blob/${tag}/DATA.md`,
    `Changes in ${release.version}:\n\n${plain(release.body)}`,
  ].join('\n\n');

  return {
    upload_type: 'dataset',
    title: TITLE,
    version: release.version,
    // Explicit, because Zenodo otherwise stamps its own clock, and a release
    // published late in the day west of UTC would carry tomorrow's date.
    publication_date: release.date,
    creators: CREATORS.map((c) => ({ name: c.name })),
    description: abstract(summary),
    access_right: 'open',
    license: ids.zenodo,
    keywords: [...KEYWORDS],
    notes,
    related_identifiers: [
      ...upstreams.map((u) => ({
        identifier: u.url,
        relation: 'isDerivedFrom',
        resource_type: 'dataset',
      })),
      { identifier: `${REPO_URL}/tree/${tag}`, relation: 'isSupplementTo', resource_type: 'software' },
      {
        identifier: `${REPO_URL}/blob/${tag}/DATA.md`,
        relation: 'isDocumentedBy',
        resource_type: 'publication-technicalnote',
      },
      { identifier: SITE_ORIGIN, relation: 'isSourceOf', resource_type: 'other' },
    ],
  };
}

const q = (v) => JSON.stringify(v);

export function buildCff({ summary, release, upstreams = UPSTREAMS }) {
  const ids = LICENCE_IDS[COLLECTION_LICENCE];
  if (!ids) throw new Error(`no Zenodo/SPDX id recorded for ${COLLECTION_LICENCE}`);
  const lines = [
    '# Generated by scripts/build-citation.mjs. Edit src/lib/citation.ts or',
    '# CHANGELOG.md and run `npm run release:meta`; a test rejects a hand edit.',
    `cff-version: ${q('1.2.0')}`,
    `title: ${q(TITLE)}`,
    `message: ${q(citeMessage(upstreams))}`,
    `type: ${q('dataset')}`,
    'authors:',
    ...CREATORS.flatMap((c) => [`  - name: ${q(c.name)}`, `    website: ${q(PUBLISHER_URL)}`]),
    `repository-code: ${q(REPO_URL)}`,
    `url: ${q(SITE_ORIGIN)}`,
    // The concept DOI only. The version DOI of the release being cut is
    // minted when it is published, after this file has been archived, so it
    // cannot be written here; the Zenodo page lists it.
    `doi: ${q(CONCEPT_DOI)}`,
    'identifiers:',
    `  - type: ${q('doi')}`,
    `    value: ${q(CONCEPT_DOI)}`,
    `    description: ${q('The concept DOI. It always resolves to the latest version; each version has its own DOI on the Zenodo page.')}`,
    `abstract: ${q(abstract(summary))}`,
    'keywords:',
    ...KEYWORDS.map((k) => `  - ${q(k)}`),
    `license: ${q(ids.spdx)}`,
    `license-url: ${q(COLLECTION_LICENCE_URL)}`,
    `version: ${q(release.version)}`,
    `date-released: ${q(release.date)}`,
  ];
  return lines.join('\n') + '\n';
}

/** Both files, as the strings that should be on disk. */
export function render() {
  const summary = JSON.parse(fs.readFileSync('data/summary.json', 'utf8'));
  const release = latestRelease(fs.readFileSync('CHANGELOG.md', 'utf8'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  // One version, stated in CHANGELOG.md. package.json is allowed to agree and
  // nothing else; a release whose tag, archive and package disagree has no
  // version at all.
  if (pkg.version !== release.version) {
    throw new Error(`package.json is ${pkg.version} but CHANGELOG.md's top release is ${release.version}`);
  }
  return {
    zenodo: JSON.stringify(buildZenodo({ summary, release }), null, 2) + '\n',
    cff: buildCff({ summary, release }),
  };
}

// `process.argv[1]` is absent under `node -e`, which docs/RELEASING.md uses to
// print a CHANGELOG section; guard it rather than throw on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { zenodo, cff } = render();
  fs.writeFileSync(ZENODO_OUT, zenodo);
  fs.writeFileSync(CFF_OUT, cff);
  console.log(`wrote ${ZENODO_OUT} and ${CFF_OUT}`);
}
