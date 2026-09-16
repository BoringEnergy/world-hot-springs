/**
 * Every record has an address, and the address resolves.
 *
 * Until this shipped the atlas had one URL for 7,490 records: nothing could be
 * cited, linked, unfurled or indexed, and a landowner asking us to remove a
 * spring had no way to say which one. Three separate pieces have to agree for
 * that to stay fixed, and each has failed independently in other projects:
 *
 *   1. the app writes and reads paths at all,
 *   2. the host rewrites unknown paths to index.html, without which every
 *      permalink is a 404 and this whole feature is worse than not having it,
 *   3. the sitemap exists, because nothing on the map links to a record and a
 *      crawler that starts at the root otherwise discovers exactly one page.
 *
 * Source guards, in the style of mapview.test.mjs: `npm test` runs only
 * scripts/ ** /*.test.mjs and there is no browser here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSitemap } from './build-sitemap.mjs';

const ROUTER = fs.readFileSync('src/lib/router.ts', 'utf8');
const STORE = fs.readFileSync('src/store/useStore.ts', 'utf8');
const DETAIL = fs.readFileSync('src/components/DetailPanel.tsx', 'utf8');
const APP = fs.readFileSync('src/App.tsx', 'utf8');

test('the deep-link path is a real path, not a fragment', () => {
  // A fragment is never sent to the server, so a hash route is invisible to
  // every crawler and every log. The point of the addresses is that they are
  // addressable by something other than this app.
  assert.match(ROUTER, /\/s\/\$\{route\.id\}/);
  assert.doesNotMatch(ROUTER, /window\.location\.hash/);
});

test('an id from the address bar is validated before it reaches state', () => {
  // Unvalidated, it goes into a store lookup and into the canonical <link>,
  // which hands a crawler an infinite space of URLs that all render nothing.
  assert.match(ROUTER, /whs_\[0-9a-f\]\{12\}/);
});

test('a permalink that matches no record does not stay in the address bar', () => {
  // A dead permalink that keeps its URL gets crawled, cached and cited.
  assert.match(STORE, /navigate\(\{ kind: 'map' \}, \{ replace: true \}\)/);
});

test('selection writes history, so Back works and the URL is shareable', () => {
  assert.match(STORE, /navigate\(\{ kind: 'spring', id \}\)/);
  assert.match(APP, /onPopState\(applyRoute\)/, 'Back must put the app where the URL says');
});

test('the permalink is visible on the card', () => {
  // An address nobody can see is an address nobody cites, and this is also the
  // route by which someone asks for their spring to be removed.
  assert.match(DETAIL, /absoluteHref\(\{ kind: 'spring', id: spring\.id \}\)/);
});

test('the host rewrites unknown paths to the app', () => {
  // Without this, /s/whs_... 404s on a cold load and every link shared is
  // broken for the person who receives it.
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const rewrite = vercel.rewrites?.find((r) => r.destination === '/index.html');
  assert.ok(rewrite, 'vercel.json must rewrite unmatched paths to /index.html');
  // The rewrite must not swallow the dataset: /data/hot-springs.geojson has to
  // keep returning GeoJSON, not the HTML shell.
  assert.ok(/data\//.test(rewrite.source), 'the rewrite must exclude /data/');
});

test('the sitemap covers every record and dates it honestly', () => {
  const geo = JSON.parse(fs.readFileSync('data/hot-springs.geojson', 'utf8'));
  const xml = buildSitemap(geo.features, 'https://example.org');
  const count = (xml.match(/<url>/g) ?? []).length;
  assert.equal(count, geo.features.length + 5, 'one URL per record, plus the root and the four standing pages');

  // lastmod is the record's own date. Stamping the build date on 7,490
  // unchanged records tells a crawler the whole atlas changed when nothing
  // did, which is the sitemap version of inventing a temperature.
  const today = new Date().toISOString().slice(0, 10);
  const stamped = (xml.match(new RegExp(`<lastmod>${today}</lastmod>`, 'g')) ?? []).length;
  assert.ok(stamped < geo.features.length, 'lastmod must not be the build date on every record');
});

test('robots points at the sitemap and at the bulk download', () => {
  const robots = fs.readFileSync('public/robots.txt', 'utf8');
  assert.match(robots, /^Sitemap: https:\/\/\S+\/sitemap\.xml$/m);
  assert.match(robots, /hot-springs\.geojson/, 'tell crawlers to take the file, not 7,490 pages');
});
