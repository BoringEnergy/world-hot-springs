/**
 * The nearest-polygon fallback must not hand coastal points to whichever
 * country has the widest bounding box.
 *
 * These fixtures are real springs that were published as `country: US` --
 * 195 of them, about 10% of the American count -- because the United States'
 * bbox spans lng -178.2 to 179.8 (the Aleutians cross the antimeridian) and
 * lat 19.0 to 71.4. A bbox that wide is zero distance from every northern
 * coastal point on Earth, so the fallback preferred it over the country the
 * point is actually beside.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { countryLookup } from './lib/countries.mjs';

const CACHE = path.join('data', 'raw', 'ne_50m_admin_0_countries.geojson');

/** Misattributed by the bbox fallback. Each is a real record from the atlas. */
const COASTAL = [
  ['Djupavogskorin', 64.65, -14.34, 'IS'],
  ['Gudlaug', 64.32, -22.06, 'IS'],
  ['Grettislaug', 65.88, -19.74, 'IS'],
  ['Bibione Thermae', 45.63, 13.04, 'IT'],
  ['Fuente Santa, La Palma', 28.46, -17.85, 'ES'],
  ['Douch pour hommes', 36.79, 3.05, 'DZ'],
  ['Gangdong No.5 Tangquan', 38.93, 121.67, 'CN'],
];

/** Must STAY American. A fix that over-corrects fails here. */
const AMERICAN = [
  ['Adak, Aleutians (west of the antimeridian)', 51.97, -176.63, 'US'],
  ['Glenwood Springs, Colorado', 39.55, -107.33, 'US'],
  ['Olympic Hot Springs, Washington', 47.98, -123.69, 'US'],
];

test('the nearest-country fallback picks the nearest country, not the widest bbox', async (t) => {
  // data/raw is gitignored and refetchable. Skip loudly rather than pass on
  // absence -- a green tick over an unread fixture is worse than no test.
  if (!fs.existsSync(CACHE)) {
    t.skip(`${CACHE} absent; run \`npm run data:build\` once to populate it`);
    return;
  }
  const lookup = await countryLookup();
  for (const [name, lat, lng, want] of [...COASTAL, ...AMERICAN]) {
    assert.equal(lookup(lat, lng).iso, want, `${name} should be ${want}`);
  }
});
