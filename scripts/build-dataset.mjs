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
import { isSameSpring } from './lib/identity.mjs';

const RAW_DIR = path.join('data', 'raw', 'osm');
const OUT_JSON = path.join('data', 'hot-springs.json');
const OUT_GEOJSON = path.join('data', 'hot-springs.geojson');
const OUT_SUMMARY = path.join('data', 'summary.json');

/**
 * Fold the loser of a duplicate pair into the winner.
 *
 * Only ever fills gaps — a known value on the winner is never overwritten by
 * the loser's. Two mappings of one spring usually know different things, and
 * discarding the loser wholesale throws away the half of the record that the
 * winner was missing.
 */
function mergeInto(winner, loser) {
  winner.sources = [...new Set([...winner.sources, ...loser.sources])];
  winner.warnings = [...new Set([...winner.warnings, ...loser.warnings])];
  winner.tags = [...new Set([...winner.tags, ...loser.tags])].sort();
  winner.name ??= loser.name;
  winner.description ??= loser.description;

  if (winner.temperature.celsius === null && loser.temperature.celsius !== null) {
    winner.temperature = { ...loser.temperature };
  }
  winner.temperature.qualitative ??= loser.temperature.qualitative;

  winner.access.price ??= loser.access.price;
  winner.access.currency ??= loser.access.currency;
  winner.access.notes ??= loser.access.notes;

  if (winner.clothing.policy === 'unknown') winner.clothing = { ...loser.clothing };
  winner.hours.open ??= loser.hours.open;
  winner.hours.seasonalNotes ??= loser.hours.seasonalNotes;
  if (winner.hours.status === 'unknown') winner.hours.status = loser.hours.status;
  if (winner.type === 'unknown') winner.type = loser.type;

  winner.location.elevation ??= loser.location.elevation;
  winner.location.region ??= loser.location.region;
  winner.location.nearestTown ??= loser.location.nearestTown;

  const c = recomputeCompleteness(winner);
  winner.quality.completeness = c.score;
  winner.quality.known = c.known;
}

const FIRST_CLASS_COUNT = 6;

function recomputeCompleteness(r) {
  const known = [];
  if (r.name) known.push('name');
  if (r.temperature.celsius !== null) known.push('temperature');
  if (r.access.price) known.push('price');
  if (r.clothing.policy !== 'unknown') known.push('clothing');
  if (r.hours.open || r.hours.status !== 'unknown') known.push('hours');
  if (r.type !== 'unknown') known.push('type');
  return { known, score: Math.round((known.length / FIRST_CLASS_COUNT) * 100) };
}

/**
 * Collapse duplicates. Keep the more complete record and merge the other's
 * knowledge in, so no provenance and no known field is lost.
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

    const dup = candidates.find((c) => isSameSpring(c, r));

    if (dup) {
      dropped++;
      // Keep whichever record knows more; fold the loser's sources in.
      const winner = r.quality.completeness > dup.quality.completeness ? r : dup;
      const loser = winner === r ? dup : r;
      mergeInto(winner, loser);
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

  // --- Reviewed bad-import list ---
  // Deliberately a human-reviewed list of specific known-bad imports rather
  // than a clever heuristic. The obvious automated rule — "a dense cluster of
  // attribute-free nodes is a bulk import" — was tested and flagged 1,957 of
  // Yellowstone's 1,959 attribute-free springs. Those are real. There is no
  // statistical signal separating a bulk import from a genuine geyser basin,
  // so this is a judgement call and it is written down as one.
  const badImports = JSON.parse(fs.readFileSync(path.join('data', 'known-bad-imports.json'), 'utf8'));
  for (const r of records) {
    if (r.quality.suspect) continue;
    const rule = badImports.imports.find(
      (imp) => imp.countries.includes(r.location.country) && imp.rule === 'attribute-free',
    );
    if (rule && r.quality.attributeFree) {
      r.quality.suspect = `matched reviewed bad import "${rule.id}": ${rule.rule}`;
    }
  }

  // --- Quarantine suspected mis-tags ---
  // Written to data/suspect.json rather than deleted, so the call is auditable
  // and reversible. If the heuristic is wrong, the evidence is right there.
  const suspects = records.filter((r) => r.quality.suspect);
  if (suspects.length) {
    records = records.filter((r) => !r.quality.suspect);
    fs.writeFileSync(path.join('data', 'suspect.json'), JSON.stringify(suspects, null, 2));
    const byCountry = {};
    for (const s of suspects) byCountry[s.location.countryName] = (byCountry[s.location.countryName] || 0) + 1;
    console.log(`  quarantined ${suspects.length} suspected mis-tags -> data/suspect.json`);
    console.log(
      `    ${Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    );
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
