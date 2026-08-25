/**
 * fetch-osm.mjs — pull every publicly-mapped hot spring out of OpenStreetMap.
 *
 * Strategy: the world is tiled into 30deg x 30deg cells and each cell is queried
 * separately. A single global Overpass query for natural=hot_spring reliably
 * times out; tiling keeps each request small enough to succeed and lets the run
 * resume after an interruption.
 *
 * Every tile response is written to data/raw/osm/tile-<id>.json. Re-running skips
 * tiles that already have a file, so a killed run costs nothing. Delete a tile
 * file to force a refetch.
 *
 * Usage:
 *   node scripts/fetch-osm.mjs            # fetch all missing tiles
 *   node scripts/fetch-osm.mjs --force    # refetch everything
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join('data', 'raw', 'osm');
const FORCE = process.argv.includes('--force');

// Overpass mirrors, tried in order. Rotating on failure works around the
// per-instance rate limiter without hammering any single host.
/**
 * Mirrors are NOT interchangeable. maps.mail.ru was dropped after it answered
 * HTTP 200 with an empty element list for a bbox containing 833 springs — a
 * silent data loss that only surfaced because of the verify pass below. Any
 * mirror added here must survive `--verify` before being trusted.
 */
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

const LON_STEP = 30;
const LAT_STEP = 30;
/**
 * Server-side query budget. The client aborts well before this so that a mirror
 * that accepts the connection and then stalls costs us 90 seconds, not four
 * minutes — that failure mode dominated the first run.
 */
const TIMEOUT_S = 180;
const CLIENT_ABORT_MS = 90_000;
const MAX_ATTEMPTS = 6;

/**
 * The tag sets we treat as "a hot spring exists here".
 *
 * natural=hot_spring is the canonical tag. amenity=public_bath with a thermal
 * bath:type covers developed onsen/thermae that mappers file under the bath
 * rather than the source, which is most of Japan and much of central Europe.
 * Those two together are the difference between ~8k and ~14k records.
 */
function overpassQuery(s, w, n, e) {
  const bbox = `${s},${w},${n},${e}`;
  return `[out:json][timeout:${TIMEOUT_S}];
(
  node["natural"="hot_spring"](${bbox});
  way["natural"="hot_spring"](${bbox});
  relation["natural"="hot_spring"](${bbox});
  node["amenity"="public_bath"]["bath:type"~"onsen|thermal|hot_spring",i](${bbox});
  way["amenity"="public_bath"]["bath:type"~"onsen|thermal|hot_spring",i](${bbox});
  relation["amenity"="public_bath"]["bath:type"~"onsen|thermal|hot_spring",i](${bbox});
);
out center tags;`;
}

function tiles() {
  const out = [];
  for (let lat = -90; lat < 90; lat += LAT_STEP) {
    for (let lon = -180; lon < 180; lon += LON_STEP) {
      out.push({
        id: `${lat}_${lon}`,
        s: lat,
        w: lon,
        n: Math.min(lat + LAT_STEP, 90),
        e: Math.min(lon + LON_STEP, 180),
      });
    }
  }
  // Fetch the populated latitudes first. Hot springs cluster on the northern
  // temperate band (Japan, Europe, western North America, the Himalaya), and a
  // run that gets interrupted should already hold the interesting half of the
  // world rather than 30 tiles of Southern Ocean.
  const priority = (t) => {
    const mid = t.s + LAT_STEP / 2;
    if (mid >= 30 && mid <= 60) return 0;
    if (mid >= 0 && mid < 30) return 1;
    if (mid > 60) return 2;
    if (mid >= -30) return 3;
    return 4;
  };
  out.sort((a, b) => priority(a) - priority(b));
  return out;
}

/**
 * Cheap server-side count for the same tag sets, used to prove a cached tile is
 * actually complete rather than merely present.
 */
function countQuery(s, w, n, e) {
  const bbox = `${s},${w},${n},${e}`;
  return `[out:json][timeout:${TIMEOUT_S}];
(
  node["natural"="hot_spring"](${bbox});
  way["natural"="hot_spring"](${bbox});
  relation["natural"="hot_spring"](${bbox});
  node["amenity"="public_bath"]["bath:type"~"onsen|thermal|hot_spring",i](${bbox});
  way["amenity"="public_bath"]["bath:type"~"onsen|thermal|hot_spring",i](${bbox});
  relation["amenity"="public_bath"]["bath:type"~"onsen|thermal|hot_spring",i](${bbox});
);
out count;`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runQuery(data, attempt = 1) {
  const mirror = MIRRORS[(attempt - 1) % MIRRORS.length];
  const body = new URLSearchParams({ data });
  try {
    const res = await fetch(mirror, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Overpass asks for a contactable UA. Identify the project honestly.
        'User-Agent': 'world-hot-springs/0.1 (open hot spring atlas; +https://github.com/)',
      },
      signal: AbortSignal.timeout(CLIENT_ABORT_MS),
    });
    if (res.status === 429 || res.status === 504 || res.status === 503) {
      throw new Error(`rate limited / busy (HTTP ${res.status})`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.elements)) throw new Error('no elements array in response');
    return json;
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err;
    // Backoff grows with attempt; Overpass slots free up on the order of a minute.
    const wait = Math.min(90_000, 5_000 * 2 ** (attempt - 1));
    console.log(`    attempt ${attempt} failed on ${new URL(mirror).host}: ${err.message} — retry in ${wait / 1000}s`);
    await sleep(wait);
    return runQuery(data, attempt + 1);
  }
}

const fetchTile = (tile) => runQuery(overpassQuery(tile.s, tile.w, tile.n, tile.e));

async function expectedCount(tile) {
  const json = await runQuery(countQuery(tile.s, tile.w, tile.n, tile.e));
  const t = json.elements[0]?.tags ?? {};
  return Number(t.total ?? 0);
}

/**
 * Prove every cached tile is complete.
 *
 * A tile file existing is not evidence that it is right: a mirror can answer
 * HTTP 200 with an empty element list, which looks exactly like "no springs
 * here". This compares each cached tile against a server-side count and
 * refetches anything short.
 */
async function verify() {
  const all = tiles();
  let repaired = 0;
  let checked = 0;
  const stillShort = [];

  for (const [i, tile] of all.entries()) {
    const file = path.join(OUT_DIR, `tile-${tile.id}.json`);
    if (!fs.existsSync(file)) continue;
    const have = JSON.parse(fs.readFileSync(file, 'utf8')).elements.length;
    const want = await expectedCount(tile);
    checked++;
    if (have >= want) {
      process.stdout.write(`[${i + 1}/${all.length}] ${tile.id}: ${have}/${want} ok\n`);
      await sleep(1_200);
      continue;
    }
    console.log(`[${i + 1}/${all.length}] ${tile.id}: ${have}/${want} SHORT — refetching`);
    try {
      const json = await fetchTile(tile);
      if (json.elements.length >= want) {
        fs.writeFileSync(file, JSON.stringify(json));
        repaired++;
        console.log(`    repaired: ${json.elements.length} elements`);
      } else {
        // Write it anyway if it is strictly better than what we had, but keep
        // the tile on the short list so the run exits non-zero.
        if (json.elements.length > have) fs.writeFileSync(file, JSON.stringify(json));
        stillShort.push({ tile: tile.id, have: json.elements.length, want });
        console.log(`    still short: ${json.elements.length}/${want}`);
      }
    } catch (err) {
      stillShort.push({ tile: tile.id, have, want, error: err.message });
      console.log(`    refetch failed: ${err.message}`);
    }
    await sleep(2_000);
  }

  console.log(`\nverified ${checked} tiles, repaired ${repaired}`);
  if (stillShort.length) {
    console.log(`${stillShort.length} tile(s) still short:`);
    for (const s of stillShort) console.log(`  ${s.tile}: ${s.have}/${s.want}${s.error ? ` (${s.error})` : ''}`);
    process.exitCode = 1;
  } else {
    console.log('every cached tile matches the server-side count.');
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (process.argv.includes('--verify')) return verify();
  const all = tiles();
  let fetched = 0;
  let skipped = 0;
  let elements = 0;
  const failures = [];

  for (const [i, tile] of all.entries()) {
    const file = path.join(OUT_DIR, `tile-${tile.id}.json`);
    if (!FORCE && fs.existsSync(file)) {
      skipped++;
      elements += JSON.parse(fs.readFileSync(file, 'utf8')).elements.length;
      continue;
    }
    process.stdout.write(`[${i + 1}/${all.length}] tile ${tile.id} (lat ${tile.s}..${tile.n}, lon ${tile.w}..${tile.e}) ... `);
    try {
      const json = await fetchTile(tile);
      fs.writeFileSync(file, JSON.stringify(json));
      elements += json.elements.length;
      fetched++;
      console.log(`${json.elements.length} elements`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failures.push({ tile: tile.id, error: err.message });
    }
    // Be a good citizen between tiles even on success.
    await sleep(2_000);
  }

  console.log(`\nfetched ${fetched} tiles, skipped ${skipped} cached, ${elements} raw elements total`);
  if (failures.length) {
    fs.writeFileSync(path.join(OUT_DIR, '_failures.json'), JSON.stringify(failures, null, 2));
    console.log(`${failures.length} tiles failed — re-run to retry them (see ${OUT_DIR}/_failures.json)`);
    process.exitCode = 1;
  }
}

main();
