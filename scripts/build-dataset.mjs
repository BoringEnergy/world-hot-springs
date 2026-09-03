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
import { isSameSpring, resolveRegistry } from './lib/identity.mjs';
import { buildTimestamp, buildDate } from './lib/buildtime.mjs';
import { loadOverlays, applyOverlays } from './lib/overlay.mjs';
import { appendEvents } from './lib/events.mjs';
import { loadLandManagers, applyLandManagers } from './lib/land-manager.mjs';

const RAW_DIR = path.join('data', 'raw', 'osm');
const OUT_JSON = path.join('data', 'hot-springs.json');
const OUT_GEOJSON = path.join('data', 'hot-springs.geojson');
const OUT_SUMMARY = path.join('data', 'summary.json');
const REGISTRY = path.join('data', 'registry.json');
const OVERLAY_DIR = path.join('data', 'overlay');
const EVENTS = path.join('data', 'events.jsonl');

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

  // Derived from the inputs so the build is reproducible. See lib/buildtime.mjs.
  const ingestedAt = buildDate(RAW_DIR);
  const generatedAt = buildTimestamp(RAW_DIR);
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

  // --- Deduplicate ---
  // Runs before the privacy guard, not after. mergeInto() adopts the winner's
  // coordinates, so a merge can move a record several hundred metres. Merging
  // after the exclusion check would let a record clear the filter at its own
  // position and then be pulled inside an exclusion radius, published.
  console.log('Deduplicating ...');
  const { records: deduped, dropped } = dedupe(records);
  records = deduped;
  console.log(`  merged ${dropped} duplicate record(s) -> ${records.length} springs`);

  // --- Durable identity ---
  // Assign each record an id of ours so a claim survives OSM redrawing the
  // spring under a new element id. Runs after dedupe so ids attach to final
  // records, not to duplicates about to be merged away.
  console.log('Resolving identity ...');
  const priorRegistry = fs.existsSync(REGISTRY)
    ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8'))
    : {};
  const { registry, assignments, events: identityEvents } = resolveRegistry(
    records,
    priorRegistry,
    ingestedAt,
  );
  for (const record of records) {
    const whsId = assignments.get(record.id);
    // Refs come from the registry, not the record id: dedupe folded several
    // OSM elements into this record and the registry holds all of them.
    // Keeping only the winner's ref would lose the others' matches next build.
    record.osmRefs = registry[whsId].osmRefs;
    record.id = whsId;
  }
  const appeared = identityEvents.filter((e) => e.type === 'spring.appeared').length;
  const vanished = identityEvents.filter((e) => e.type === 'spring.disappeared').length;
  console.log(`  ${Object.keys(registry).length} springs in the registry`);
  if (appeared) console.log(`  ${appeared} new since the last build`);
  if (vanished) console.log(`  ${vanished} no longer present upstream (flagged, not deleted)`);

  // --- Curated overlay ---
  console.log('Applying curated claims ...');
  const overlays = loadOverlays(OVERLAY_DIR);
  const { applied, orphaned, events: overlayEvents } = applyOverlays(records, overlays);
  console.log(`  ${applied} claim(s) applied from ${overlays.size} overlay file(s)`);
  const contested = overlayEvents.filter((e) => e.type === 'claim.contested').length;
  if (contested) console.log(`  ${contested} claim(s) now disagree with upstream`);

  if (orphaned.length) {
    // A claim with nowhere to land is a correction about to vanish silently.
    console.error(`FATAL: ${orphaned.length} overlay file(s) reference springs absent from this build:`);
    for (const id of orphaned) console.error(`  ${id}`);
    console.error('Their claims would be silently discarded. Check data/registry.json for a');
    console.error('missingSince flag on these ids before removing the overlay files.');
    process.exit(1);
  }

  // --- Land-manager restrictions ---
  // After the overlay, deliberately. Running last of the two means no authored
  // claim can weaken an agency prohibition: a contributor cannot assert that
  // bathing is allowed in Yellowstone and have it stick. This stage only ever
  // tightens, and it only ever modifies fields on records that already exist —
  // it never adds, moves or removes one — which is why it is safe above the
  // privacy filter.
  console.log('Applying land-manager restrictions ...');
  const landManagers = loadLandManagers();
  const { applied: restricted, byManager } = applyLandManagers(records, landManagers);
  console.log(`  ${restricted} spring(s) restricted by ${landManagers.length} land manager(s)`);
  for (const [id, n] of byManager) console.log(`    ${id}: ${n}`);

  // --- The privacy guard ---
  // Genuinely last: nothing that can add, move, or reintroduce a record may run
  // below this point. This is the promise in PRIVACY.md, and build.test.mjs
  // asserts the ordering so it cannot quietly regress.
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

  // Claim accounting. Exclusion always wins, but a suppressed claim must be
  // reported: the overlay file is now dead weight, and it points at a location
  // we have promised to protect.
  const survivingIds = new Set(records.map((r) => r.id));
  const suppressed = [...overlays.keys()].filter((id) => !survivingIds.has(id));
  if (suppressed.length) {
    console.log(`  ${suppressed.length} overlay file(s) suppressed by the privacy filter`);
    console.log('    Remove them from data/overlay/. Their springs are excluded.');
    // Ids only. Never log the claim contents or the matched rule -- a detailed
    // message is an oracle for locating exactly what the exclusion list protects.
    for (const id of suppressed) console.log(`    ${id}`);
  }

  records.sort((a, b) =>
    (a.location.countryName || '').localeCompare(b.location.countryName || '') ||
    (a.name || '￿').localeCompare(b.name || '￿'),
  );

  // --- Outputs ---
  fs.writeFileSync(OUT_JSON, JSON.stringify(records));

  const geojson = {
    type: 'FeatureCollection',
    // Attribution travels with the data, not just the README.
    metadata: {
      name: "World Hot Springs — public hot spring atlas",
      generated: generatedAt,
      count: records.length,
      license: 'ODbL 1.0 (derived from OpenStreetMap)',
      attribution: '© OpenStreetMap contributors',
      note: 'Hidden local springs are deliberately excluded. See PRIVACY.md.',
    },
    features: records.map((r) => ({
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
  for (const r of records) {
    const key = `${r.location.country}|${r.location.countryName}`;
    byCountry[key] = (byCountry[key] || 0) + 1;
    byType[r.type] = (byType[r.type] || 0) + 1;
    if (r.temperature.celsius !== null) withTemp++;
    if (r.access.price) withPrice++;
    if (r.hours.open) withHours++;
    if (r.clothing.policy !== 'unknown') withClothing++;
  }

  const summary = {
    generated: generatedAt,
    total: records.length,
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
    landManagerRestricted: Object.fromEntries(byManager),
  };
  fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));
  fs.writeFileSync(REGISTRY, JSON.stringify(registry, null, 2) + '\n');
  const written = appendEvents(EVENTS, [...identityEvents, ...overlayEvents], generatedAt);
  if (written) console.log(`  ${written} new event(s) recorded in ${EVENTS}`);

  console.log(`\n${records.length} springs across ${summary.countries} countries`);
  console.log(`  temperature known: ${withTemp} (${Math.round((withTemp / records.length) * 100)}%)`);
  console.log(`  price known:       ${withPrice} (${Math.round((withPrice / records.length) * 100)}%)`);
  console.log(`  hours known:       ${withHours} (${Math.round((withHours / records.length) * 100)}%)`);
  console.log(`  clothing known:    ${withClothing} (${Math.round((withClothing / records.length) * 100)}%)`);
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
