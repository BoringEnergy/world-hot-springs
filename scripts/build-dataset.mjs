/**
 * build-dataset.mjs — turn cached Overpass responses into the curated dataset.
 *
 * Reads   data/raw/osm/tile-*.json   (produced by fetch-osm.mjs)
 * Writes  data/hot-springs.json      (full records, the source of truth)
 *         data/hot-springs.geojson   (same records as a FeatureCollection)
 *         data/summary.json          (counts the UI and README quote)
 *
 * Every stage prints what it dropped and why. A pipeline that silently discards
 * records is a pipeline you cannot trust.
 */
import fs from 'node:fs';
import path from 'node:path';
import { countryLookup } from './lib/countries.mjs';
import { normalizeElement } from './lib/normalize.mjs';
import { loadExclusions, isExcluded } from './lib/exclusions.mjs';

const RAW_DIR = path.join('data', 'raw', 'osm');
const OUT_JSON = path.join('data', 'hot-springs.json');
const OUT_GEOJSON = path.join('data', 'hot-springs.geojson');
const OUT_SUMMARY = path.join('data', 'summary.json');

/** Two records closer than this with a compatible name are the same spring. */
const DEDUPE_METERS = 60;

function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function normName(n) {
  return (n || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Collapse duplicates. The common case is one spring mapped as both a node
 * (the source) and a way (the pool around it). Keep the more complete record
 * and merge the other's sources so no provenance is lost.
 */
function dedupe(records) {
  // Spatial hash at ~1km so we compare each record against a handful of
  // neighbours instead of all 14k.
  const buckets = new Map();
  const key = (r) => `${Math.round(r.location.lat * 100)}:${Math.round(r.location.lng * 100)}`;
  const merged = [];
  let dropped = 0;

  for (const r of records) {
    const k = key(r);
    const candidates = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const [a, b] = k.split(':').map(Number);
        candidates.push(...(buckets.get(`${a + dy}:${b + dx}`) || []));
      }
    }

    const dup = candidates.find((c) => {
      if (haversine(c.location, r.location) > DEDUPE_METERS) return false;
      const an = normName(c.name);
      const bn = normName(r.name);
      // Same spot and neither contradicts the other on name.
      return !an || !bn || an === bn || an.includes(bn) || bn.includes(an);
    });

    if (dup) {
      dropped++;
      // Keep whichever record knows more; fold the loser's sources in.
      const winner = r.quality.completeness > dup.quality.completeness ? r : dup;
      const loser = winner === r ? dup : r;
      winner.sources = [...new Set([...winner.sources, ...loser.sources])];
      winner.name = winner.name || loser.name;
      winner.warnings = [...new Set([...winner.warnings, ...loser.warnings])];
      winner.tags = [...new Set([...winner.tags, ...loser.tags])].sort();
      if (winner !== dup) {
        const arr = buckets.get(key(dup));
        arr.splice(arr.indexOf(dup), 1);
        merged.splice(merged.indexOf(dup), 1);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(winner);
        merged.push(winner);
      }
      continue;
    }

    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
    merged.push(r);
  }

  return { records: merged, dropped };
}

async function main() {
  if (!fs.existsSync(RAW_DIR)) {
    console.error(`No raw data at ${RAW_DIR}. Run \`npm run data:fetch\` first.`);
    process.exit(1);
  }

  const ingestedAt = new Date().toISOString().slice(0, 10);
  const files = fs.readdirSync(RAW_DIR).filter((f) => f.startsWith('tile-') && f.endsWith('.json'));
  console.log(`Reading ${files.length} tile files ...`);

  const elements = [];
  const seenOsmIds = new Set();
  for (const f of files) {
    const json = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8'));
    for (const el of json.elements) {
      // Tiles share edges; the same element can appear in two of them.
      const k = `${el.type}/${el.id}`;
      if (seenOsmIds.has(k)) continue;
      seenOsmIds.add(k);
      elements.push(el);
    }
  }
  console.log(`  ${elements.length} unique OSM elements`);

  console.log('Resolving countries ...');
  const lookup = await countryLookup();

  console.log('Normalizing ...');
  const rejects = new Map();
  let records = [];
  for (const el of elements) {
    const { record, reject } = normalizeElement(el, lookup, ingestedAt);
    if (reject) {
      rejects.set(reject, (rejects.get(reject) || 0) + 1);
      continue;
    }
    records.push(record);
  }
  console.log(`  ${records.length} records`);
  for (const [reason, n] of [...rejects].sort((a, b) => b[1] - a[1])) {
    console.log(`  dropped ${n} — ${reason}`);
  }

  // --- The privacy guard. This runs last so nothing can slip past it. ---
  const exclusions = loadExclusions();
  const before = records.length;
  records = records.filter((r) => !isExcluded(r, exclusions));
  const excluded = before - records.length;
  if (exclusions.entries.length) {
    console.log(`  excluded ${excluded} record(s) via the private exclusion list`);
  }
  // Hard invariant: nothing in the public dataset is ever flagged a unicorn.
  const leaked = records.filter((r) => r.unicorn !== false);
  if (leaked.length) {
    console.error(`FATAL: ${leaked.length} record(s) carry unicorn !== false. Refusing to write.`);
    process.exit(1);
  }

  console.log('Deduplicating ...');
  const { records: deduped, dropped } = dedupe(records);
  console.log(`  merged ${dropped} duplicate record(s) -> ${deduped.length} springs`);

  deduped.sort((a, b) =>
    (a.location.countryName || '').localeCompare(b.location.countryName || '') ||
    (a.name || '￿').localeCompare(b.name || '￿'),
  );

  // --- Outputs ---
  fs.writeFileSync(OUT_JSON, JSON.stringify(deduped));

  const geojson = {
    type: 'FeatureCollection',
    // Attribution travels with the data, not just the README.
    metadata: {
      name: "World Hot Springs — public hot spring atlas",
      generated: new Date().toISOString(),
      count: deduped.length,
      license: 'ODbL 1.0 (derived from OpenStreetMap)',
      attribution: '© OpenStreetMap contributors',
      note: 'Hidden local springs are deliberately excluded. See PRIVACY.md.',
    },
    features: deduped.map((r) => ({
      type: 'Feature',
      id: r.id,
      geometry: { type: 'Point', coordinates: [r.location.lng, r.location.lat] },
      properties: r,
    })),
  };
  fs.writeFileSync(OUT_GEOJSON, JSON.stringify(geojson));

  const byCountry = {};
  const byType = {};
  let withTemp = 0;
  let withPrice = 0;
  let withHours = 0;
  let withClothing = 0;
  for (const r of deduped) {
    const key = `${r.location.country}|${r.location.countryName}`;
    byCountry[key] = (byCountry[key] || 0) + 1;
    byType[r.type] = (byType[r.type] || 0) + 1;
    if (r.temperature.celsius !== null) withTemp++;
    if (r.access.price) withPrice++;
    if (r.hours.open) withHours++;
    if (r.clothing.policy !== 'unknown') withClothing++;
  }

  const summary = {
    generated: new Date().toISOString(),
    total: deduped.length,
    countries: Object.keys(byCountry).length,
    coverage: {
      temperature: withTemp,
      price: withPrice,
      hours: withHours,
      clothing: withClothing,
    },
    byType,
    byCountry: Object.fromEntries(
      Object.entries(byCountry)
        .map(([k, v]) => [k.split('|')[1], v])
        .sort((a, b) => b[1] - a[1]),
    ),
    droppedDuplicates: dropped,
    rejected: Object.fromEntries(rejects),
    excludedByPrivacyList: excluded,
  };
  fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));

  console.log(`\n${deduped.length} springs across ${summary.countries} countries`);
  console.log(`  temperature known: ${withTemp} (${Math.round((withTemp / deduped.length) * 100)}%)`);
  console.log(`  price known:       ${withPrice} (${Math.round((withPrice / deduped.length) * 100)}%)`);
  console.log(`  hours known:       ${withHours} (${Math.round((withHours / deduped.length) * 100)}%)`);
  console.log(`  clothing known:    ${withClothing} (${Math.round((withClothing / deduped.length) * 100)}%)`);
  // The app fetches the dataset at runtime rather than bundling it, so the
  // shell paints immediately and the 14k points stream in after.
  const publicDir = path.join('public', 'data');
  fs.mkdirSync(publicDir, { recursive: true });
  for (const f of [OUT_GEOJSON, OUT_SUMMARY]) {
    fs.copyFileSync(f, path.join(publicDir, path.basename(f)));
  }

  console.log(`\nwrote ${OUT_JSON}, ${OUT_GEOJSON}, ${OUT_SUMMARY} (+ copies in public/data/)`);
}

main();
