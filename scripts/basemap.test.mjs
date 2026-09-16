/**
 * The atlas does not ship an unlicensed basemap.
 *
 * This project's entire claim is that it gets provenance and licensing right:
 * DATA.md names five upstreams, a test asserts the attribution cannot drift
 * from what shipped, and the README argues that inheriting the strictest term
 * beats inheriting the convenient one. Meanwhile the map streamed Esri's World
 * Imagery from server.arcgisonline.com with no key and no subscription, whose
 * product terms scope basemap content to use with Esri platform services.
 *
 * That is the single most damaging thing a critic could find here, because it
 * is not a mistake about the data -- it is the project failing its own stated
 * standard. This test is the reason it cannot come back quietly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASEMAP = fs.readFileSync('src/lib/basemap.ts', 'utf8');
const MAPVIEW = fs.readFileSync('src/components/MapView.tsx', 'utf8');

test('no tile URL is hardcoded in the map component', () => {
  // One file holds every host this app requests, with its terms next to it.
  // A URL typed into a component is a URL whose licence nobody reviews.
  assert.doesNotMatch(MAPVIEW, /https?:\/\/[^'"\s]*\{z\}/, 'tile URLs belong in lib/basemap.ts');
});

test('Esri imagery is not the shipped provider', () => {
  const chosen = BASEMAP.match(/export const IMAGERY: ImageryProvider = '([a-z0-9]+)'/)?.[1];
  assert.ok(chosen, 'basemap.ts must declare one imagery provider');
  assert.notEqual(chosen, 'esri', 'Esri basemap content is not licensed for keyless third-party use');
});

test('every imagery option carries its terms in plain language', () => {
  // A licence identifier alone is not a disclosure. The non-commercial
  // restriction on the current provider has to be readable by whoever decides
  // whether this project can ever charge for anything.
  assert.match(BASEMAP, /CC BY-NC-SA 4\.0/);
  assert.match(BASEMAP, /NON-COMMERCIAL/);
});

test('the imagery layer is optional, so turning it off is a real choice', () => {
  // 'none' is only an option if every use site is guarded. If MapView assumes
  // imagery exists, the escape hatch is decorative.
  assert.match(BASEMAP, /'none'/);
  assert.match(MAPVIEW, /if \(imagery\) \{/, 'MapView must tolerate no imagery layer');
});

test('the privacy page can enumerate every third party', () => {
  // The privacy page renders this list. A host added to the map without being
  // added here is an undisclosed third party, which is the specific failure
  // that makes a privacy policy a lie rather than a document.
  assert.match(BASEMAP, /THIRD_PARTIES/);
  const privacy = fs.readFileSync('src/components/LegalPages.tsx', 'utf8');
  assert.match(privacy, /THIRD_PARTIES\.map\(/, 'the list must be rendered, not typed');
});
