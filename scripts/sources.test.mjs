/**
 * Attribution, and the documents that have to agree with it.
 *
 * One of these five licences REQUIRES attribution rather than inviting it, so
 * a stale credit is not a tidiness problem. The README said "derives from
 * OpenStreetMap" for a month after that stopped being the whole truth, and
 * nothing caught it — these tests are what would.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { UPSTREAMS, COLLECTION_LICENCE, licenceMetadata, attributionLine } from './lib/sources.mjs';

const DATA_MD = fs.readFileSync('DATA.md', 'utf8');
const README = fs.readFileSync('README.md', 'utf8');
const GEOJSON = JSON.parse(fs.readFileSync('data/hot-springs.geojson', 'utf8'));

test('every upstream the pipeline names is credited, and no other', () => {
  // Both directions. A source listed here that never touched a record would
  // be a credit nobody earned; one in the data and not here is a credit
  // somebody is owed.
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const inData = new Set(all.flatMap((s) => s.quality.provenance));
  const listed = new Set(UPSTREAMS.map((u) => u.provider));
  assert.deepEqual([...inData].sort(), [...listed].sort());
});

test('every upstream states a licence and someone to attribute', () => {
  for (const u of UPSTREAMS) {
    for (const field of ['provider', 'name', 'licence', 'licenceUrl', 'attribution', 'url']) {
      assert.ok(u[field], `${u.provider} is missing ${field}`);
    }
    assert.match(u.url, /^https:\/\//, u.provider);
  }
});

test('the licence travels with the data, not only with the README', () => {
  const m = GEOJSON.metadata;
  assert.equal(m.license, COLLECTION_LICENCE);
  assert.ok(m.licenseUrl.startsWith('https://'));
  assert.equal(m.sources.length, UPSTREAMS.length);
  // Emitted American, held British. The two spellings once passed an
  // undefined between them and the build threw; this pins both.
  for (const s of m.sources) {
    assert.ok(s.license, `${s.provider} emitted no license`);
    assert.ok(s.licenseUrl, `${s.provider} emitted no licenseUrl`);
    assert.ok(s.attribution, `${s.provider} emitted no attribution`);
  }
  assert.equal(m.attribution, attributionLine());
  for (const u of UPSTREAMS) assert.ok(m.attribution.includes(u.attribution), u.provider);
});

test('the collection is ODbL, because share-alike does not dilute', () => {
  // Mixing ODbL with public-domain and CC BY sources does not weaken the
  // share-alike obligation. The derived database inherits the strictest
  // term, not the most convenient one.
  assert.equal(COLLECTION_LICENCE, 'ODbL 1.0');
  assert.ok(UPSTREAMS.some((u) => u.licence === 'ODbL 1.0'), 'something must make it ODbL');
  assert.match(licenceMetadata().licenseNote, /share-alike/);
});

test('DATA.md names every source, its licence and its attribution', () => {
  // The document five specs promised and none created until now.
  for (const u of UPSTREAMS) {
    assert.ok(DATA_MD.includes(u.name), `DATA.md does not name ${u.provider}`);
    assert.ok(DATA_MD.includes(u.attribution), `DATA.md does not attribute ${u.provider}`);
    assert.ok(DATA_MD.includes(`\`${u.provider}\``), `DATA.md does not tag ${u.provider}`);
  }
});

test('the README no longer claims a single parent', () => {
  assert.ok(README.includes('DATA.md'), 'the README must point at the full list');
  assert.ok(
    !README.includes('Current build derives from OpenStreetMap'),
    'that sentence was true once and is not now',
  );
  // The one attribution that is a condition of use, not a courtesy.
  assert.ok(README.includes('attribution required'));
});

test('AIST is flagged as the licence that obliges this page', () => {
  const aist = UPSTREAMS.find((u) => u.provider === 'aist');
  assert.match(aist.licence, /attribution required/);
  assert.match(DATA_MD, /This is the licence that obliges this page/);
});
