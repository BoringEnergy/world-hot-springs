/**
 * Build data/reference/wqp-spring-temps.tsv from the Water Quality Portal.
 *
 *   node scripts/fetch-wqp.mjs            resume, then write the mirror
 *   node scripts/fetch-wqp.mjs --fresh    discard the cache and start over
 *
 * THIS IS A ONE-OFF, OUT-OF-BAND FETCH. 133 tiles, up to two queries each,
 * and the service answers in roughly a minute whatever it is asked -- so
 * expect two to four hours. It is not run by CI, not by data:build, and not
 * inside a session.
 *
 * A SNAPSHOT, NOT A PINNED DERIVATION -- and this is a departure.
 *
 * fetch-ncei.mjs and fetch-aist.mjs both verify a published archive by
 * sha256, so their mirrors are reproducible derivations of bytes whose
 * identity is proven. The Water Quality Portal publishes no archive. It is a
 * query, and running it next month returns more rows because USGS keeps
 * measuring. There is nothing to hash.
 *
 * So the MIRROR is the pinned artefact: it carries the date it was taken and
 * its own sha256, and data:build is deterministic from it exactly as before.
 * What is no longer true -- and is written in the mirror's own header so
 * nobody has to infer it -- is that re-running this script reproduces the
 * file. Decided in docs/superpowers/specs/2026-09-11-wqp-us-upstream.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  TILES, tileUrl, parseStations, parseResults, joinReadings, toTsv,
  WQP_SOURCE, WQP_PAGE,
} from './lib/wqp.mjs';

const CACHE = path.join('data', 'reference', '.wqp-cache');
const OUT = path.join('data', 'reference', 'wqp-spring-temps.tsv');
const TIMEOUT_MS = 420_000;
const ATTEMPTS = 3;

const fresh = process.argv.includes('--fresh');
if (fresh && fs.existsSync(CACHE)) fs.rmSync(CACHE, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const tag = ([lat, lng]) => `${lat}_${lng}`;

/**
 * Cached per tile so the run is resumable. A four-hour job WILL be
 * interrupted, and re-fetching 130 tiles because the last one failed is how
 * a long fetch becomes one nobody runs.
 */
async function fetchTile(kind, tile) {
  const file = path.join(CACHE, `${tag(tile)}-${kind}.csv`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(tileUrl(kind, tile), { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      fs.writeFileSync(file, text);
      return text;
    } catch (err) {
      if (attempt === ATTEMPTS) {
        // Recorded, not thrown. One dead tile must not cost the other 132,
        // and the mirror header names what is missing so the gap is visible
        // rather than silently absent.
        console.error(`  !! ${tag(tile)} ${kind}: ${err.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
  return null;
}

const rows = [];
const failed = [];
let stationCount = 0;
let emptyTiles = 0;

for (const [i, tile] of TILES.entries()) {
  const label = `[${String(i + 1).padStart(3)}/${TILES.length}] ${tag(tile)}`;
  const stationCsv = await fetchTile('Station', tile);
  if (stationCsv === null) { failed.push(`${tag(tile)}/Station`); continue; }
  const stations = parseStations(stationCsv);
  if (stations.size === 0) {
    // No stations means no readings, so the second query is skipped. Roughly
    // a third of the grid is empty ocean or unmonitored ground, and each
    // skip is a minute not spent.
    emptyTiles++;
    console.log(`${label}  no spring stations`);
    continue;
  }
  stationCount += stations.size;
  const resultCsv = await fetchTile('Result', tile);
  if (resultCsv === null) { failed.push(`${tag(tile)}/Result`); continue; }
  const joined = joinReadings(stations, parseResults(resultCsv));
  rows.push(...joined);
  console.log(`${label}  ${stations.size} stations, ${joined.length} readings`);
}

// One tile's bounding box shares an edge with its neighbour's, so a station
// on the seam is returned by both. Deduplicated on the fields that identify a
// reading rather than on object identity.
const seen = new Set();
const unique = rows.filter((r) => {
  const key = `${r.station}|${r.measuredAt}|${r.celsius}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
unique.sort((a, b) => a.station.localeCompare(b.station)
  || String(a.measuredAt).localeCompare(String(b.measuredAt))
  || a.celsius - b.celsius);

const body = toTsv(unique);
const taken = new Date().toISOString().slice(0, 10);
const header = [
  `# ${WQP_SOURCE}`,
  `# source:    ${WQP_PAGE}`,
  `# taken:     ${taken}`,
  `# sha256:    ${crypto.createHash('sha256').update(body).digest('hex')}`,
  '# licence:   US federal, public domain. Attribution to USGS/EPA/NWQMC.',
  '# generated: scripts/fetch-wqp.mjs -- do not edit by hand',
  '#',
  '# A SNAPSHOT, NOT A PINNED DERIVATION. The upstream is a query, not an',
  '# archive: re-running the fetcher returns more rows, because USGS keeps',
  '# measuring. The sha256 above is of THIS FILE, so data:build stays',
  '# reproducible from it -- but nothing reproduces the fetch.',
  '#',
  `# tiles:     ${TILES.length}, of which ${emptyTiles} held no spring stations`,
  `# stations:  ${stationCount}`,
  `# readings:  ${unique.length} (${rows.length - unique.length} duplicates on tile seams removed)`,
  failed.length
    ? `# INCOMPLETE: ${failed.length} quer(y|ies) failed after ${ATTEMPTS} attempts: ${failed.join(' ')}`
    : '# complete:  every tile answered',
].join('\n');

fs.writeFileSync(OUT, `${header}\n${body}`);
console.log(`\nwrote ${OUT}`);
console.log(`  ${unique.length} readings from ${stationCount} stations across ${TILES.length} tiles`);
if (failed.length) console.log(`  INCOMPLETE: ${failed.length} failed quer(y|ies) -- rerun to resume`);
