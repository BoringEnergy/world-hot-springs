/**
 * Rebuild data/reference/iceland-geothermal-2003.tsv from Náttúrufræðistofnun's
 * WFS.
 *
 * Maintainer-run, NEVER part of `data:build`, like fetch-ncei.mjs: the build
 * reads the committed mirror so it stays offline and byte-reproducible. A WFS
 * response is not a fixed file, so there are no upstream bytes to pin; the
 * mirror pins the hash of its own rows instead, and the build refuses a mirror
 * whose rows no longer match.
 *
 *   node scripts/fetch-iceland-geothermal.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { WFS_URL, rowsFromGeoJson, toTsv } from './lib/iceland-geothermal.mjs';

const OUT = path.join('data', 'reference', 'iceland-geothermal-2003.tsv');

const res = await fetch(WFS_URL);
if (!res.ok) throw new Error(`WFS returned ${res.status}`);
const rows = rowsFromGeoJson(await res.json());
if (rows.length < 1000) throw new Error(`expected ~1,037 points, got ${rows.length}; not overwriting the mirror`);
fs.writeFileSync(OUT, toTsv(rows, new Date().toISOString().slice(0, 10)));
console.log(`wrote ${rows.length} points -> ${OUT}`);
