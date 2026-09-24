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
import { normalizeElement, reconcileTemperatureWarnings, completeness } from './lib/normalize.mjs';
import { loadExclusions, isExcluded } from './lib/exclusions.mjs';
import { isSameSpring, resolveRegistry } from './lib/identity.mjs';
import { compileBadImports, matchBadImport, unmatchedIds } from './lib/bad-imports.mjs';
import { findCoarseDuplicates, nceiRefOf } from './lib/coarse-pins.mjs';
import { groupSites, sitesByCountry, SITE_LINK_METERS } from './lib/sites.mjs';
import { compileInventories, compareWithInventories } from './lib/completeness.mjs';
import { buildTimestamp, buildDate } from './lib/buildtime.mjs';
import { loadOverlays, applyOverlays } from './lib/overlay.mjs';
import { appendEvents } from './lib/events.mjs';
import { loadLandManagers, applyLandManagers } from './lib/land-manager.mjs';
import { parseNcei } from './lib/ncei.mjs';
import { matchNcei, hasAuthoredTemperature } from './lib/ncei-match.mjs';
import { classify, toRecord, refKey, NCEI_PROVIDER } from './lib/ncei-admit.mjs';
import { aistClassification } from './lib/senshitsu.mjs';
import { fromTsv as wqpFromTsv, WQP_SOURCE, WQP_PAGE, WQP_PROVIDER } from './lib/wqp.mjs';
import { matchWqp, compareWqp } from './lib/wqp-match.mjs';
import { fromTsv as nbmgFromTsv, NBMG_PAGE, NBMG_PROVIDER } from './lib/nbmg.mjs';
import { matchNbmg } from './lib/nbmg-match.mjs';
import { reconcileAccuracy } from './lib/accuracy.mjs';
import { licenceMetadata } from './lib/sources.mjs';
import { fromTsv, AIST_PROVIDER, AIST_SOURCE, AIST_PAGE } from './lib/aist.mjs';
import { matchAist, agreedValue, agreedUnit, agreedYear, NUMERIC_FIELDS as AIST_NUMERIC_FIELDS } from './lib/aist-match.mjs';

const RAW_DIR = path.join('data', 'raw', 'osm');
const OUT_JSON = path.join('data', 'hot-springs.json');
const OUT_GEOJSON = path.join('data', 'hot-springs.geojson');
const OUT_SUMMARY = path.join('data', 'summary.json');
const OUT_COMPLETENESS = path.join('data', 'completeness.json');
const INVENTORIES = path.join('data', 'reference', 'official-inventories.json');
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
 *
 * Exported for the tests. The provenance union is the one part of this that
 * today's data cannot exercise — both sides of all 1,167 merges are `['osm']`
 * — so it is only ever checked directly.
 */
export function mergeInto(winner, loser) {
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

  // Every provider that contributed to either record, named by the survivor.
  // The loser's knowledge lives on in the winner, so dropping the provider
  // that supplied it would leave the record citing evidence it no longer
  // admits to having used. Sorted and deduplicated so the merged record does
  // not depend on which of the two happened to be the more complete one.
  winner.quality.provenance = [
    ...new Set([...winner.quality.provenance, ...loser.quality.provenance]),
  ].sort();

  const c = completeness(winner);
  winner.quality.completeness = c.score;
  winner.quality.known = c.known;
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
  const badImports = compileBadImports(
    JSON.parse(fs.readFileSync(path.join('data', 'known-bad-imports.json'), 'utf8')),
  );
  for (const r of records) {
    if (r.quality.suspect) continue;
    const rule = matchBadImport(badImports, r);
    if (rule) r.quality.suspect = `matched reviewed bad import "${rule.id}": ${rule.rule}`;
  }
  for (const stale of unmatchedIds(badImports, records)) {
    console.log(`  known-bad-imports names a record the upstream no longer has -- ${stale}`);
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

  // --- NCEI admission ---
  // Creates records, so it must run above dedupe and identity: a record made
  // after resolveRegistry never gets a durable whs_ id, and refsOf() throws by
  // name for exactly that case. Placed here it also passes through
  // isSameSpring, a second net under the 200 m matcher, and through the
  // privacy filter, which is last.
  const NCEI_TSV_ADMIT = path.join('data', 'reference', 'ncei-thermal-springs.tsv');
  if (fs.existsSync(NCEI_TSV_ADMIT)) {
    console.log('Admitting NCEI springs ...');
    const { springs: allRows } = parseNcei(fs.readFileSync(NCEI_TSV_ADMIT, 'utf8'));
    const admitManagers = loadLandManagers();
    // Only rows that match nothing already in the atlas are candidates. A row
    // that matches is stage one's business, not this stage's.
    const { unmatched } = matchNcei(allRows, records);

    const admitted = [];
    const candidates = [];
    for (const { row } of unmatched) {
      const verdict = classify(row, admitManagers);
      if (verdict.admit) admitted.push(toRecord(row, ingestedAt));
      else candidates.push({ ...row, reason: verdict.reason });
    }
    records = [...records, ...admitted];

    fs.writeFileSync(
      path.join('data', 'ncei-candidates.json'),
      `${JSON.stringify(
        {
          generatedAt: ingestedAt,
          note:
            'NOAA rows that did not become springs, and why. Public because ' +
            'calling a row unfit is a claim and must be arguable. Never deleted.',
          counts: candidates.reduce((acc, c) => ({ ...acc, [c.reason]: (acc[c.reason] ?? 0) + 1 }), {
            admitted: admitted.length,
          }),
          candidates,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `  ${admitted.length} admitted, ${candidates.length} quarantined -> data/ncei-candidates.json`,
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

  // --- Coarse NOAA pins beside the spring they name ---
  // A NOAA pin can sit up to ~1.3 km from the OSM pin for the same spring,
  // past dedupe's reach (see coarse-pins.mjs for the measurement). The pin is
  // dropped here and its row is bound to the OSM record in the NCEI stage
  // below, so what NOAA knows arrives through that stage's rules instead of a
  // second, looser merge.
  const { bound: coarseBound, refused: coarseRefused } = findCoarseDuplicates(records);
  const absorbedPins = new Set(coarseBound.map((b) => b.pin));
  const coarseBindings = new Map(coarseBound.map((b) => [nceiRefOf(b.pin), b]));
  records = records.filter((r) => !absorbedPins.has(r));
  console.log(
    `  ${coarseBound.length} NOAA pin(s) bound to the spring they name -> ${records.length} springs` +
      (coarseRefused.length ? `, ${coarseRefused.length} left alone as ambiguous` : ''),
  );

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
  // Where an absorbed pin's id went. Its entry is flagged missing like any
  // other, and says which spring it became, so a citation of the old id can
  // be followed rather than dead-ending. Cleared when an id comes back.
  for (const entry of Object.values(registry)) {
    if (!entry.missingSince) delete entry.mergedInto;
  }
  for (const b of coarseBound) {
    const ref = nceiRefOf(b.pin);
    const from = Object.keys(registry).find((id) =>
      registry[id].sourceRefs.some((r) => r.provider === NCEI_PROVIDER && r.externalId === ref),
    );
    if (!from || from === b.into.id) continue;
    registry[from].mergedInto = b.into.id;
    const i = identityEvents.findIndex((e) => e.type === 'spring.disappeared' && e.springId === from);
    if (i >= 0) identityEvents[i] = { type: 'spring.merged', springId: from, to: b.into.id, actor: 'build' };
  }
  const appeared = identityEvents.filter((e) => e.type === 'spring.appeared').length;
  const vanished = identityEvents.filter((e) => e.type === 'spring.disappeared').length;
  // Disagreements a source stage saw while stepping aside for a claim. The
  // stage writes nothing for a claimed field, so the overlay finds nothing
  // upstream to disagree with; these are the contests it cannot see.
  const sourceEvents = [];
  console.log(`  ${Object.keys(registry).length} springs in the registry`);
  if (appeared) console.log(`  ${appeared} new since the last build`);
  if (vanished) console.log(`  ${vanished} no longer present upstream (flagged, not deleted)`);

  // --- NCEI, a second upstream ---
  // Peer to OSM, not a curated claim: this never passes through gate 2, so what
  // stands in for verification is a pinned hash and a report a human reads.
  // Placed here deliberately -- above the privacy filter because proximity
  // matching binds records, and before the overlay so an authored claim wins.
  // Loaded here rather than at the overlay stage below, because NCEI has to
  // ask whether an author has already claimed a temperature. "The atlas has no
  // temperature yet" is not the same question -- the overlay has not run.
  const overlays = loadOverlays(OVERLAY_DIR);

  const NCEI_TSV = path.join('data', 'reference', 'ncei-thermal-springs.tsv');
  if (fs.existsSync(NCEI_TSV)) {
    console.log('Merging NCEI thermal springs ...');
    const { springs: nceiRows, rejected: parseRejects } = parseNcei(
      fs.readFileSync(NCEI_TSV, 'utf8'),
    );
    const byId = new Map(records.map((r) => [r.id, r]));
    // Match against the springs that were already here, NOT against the pins
    // this same build just created.
    //
    // Admission runs above dedupe and therefore BEFORE this stage, so by the
    // time enrichment ran, 1,023 NOAA rows had already become records sitting
    // at their own coordinates. Every one of them then matched itself. The
    // outcome was harmless -- an admitted record already holds NOAA's value,
    // so there was nothing to fill and nothing to conflict -- but the REPORT
    // said "1,157 matched" when NOAA had corroborated 131 springs the atlas
    // already had. That reads as independent agreement and it is not: 1,023 of
    // those were NOAA agreeing with itself.
    //
    // A record carrying an ncei ref and no other provenance is a pin this
    // upstream minted. Excluding them is what makes the count mean what it
    // says, and it drops ~7.6M distance computations on the way.
    const mintedHere = new Set(
      records
        .filter((r) => r.quality.provenance.length === 1 && r.quality.provenance[0] === NCEI_PROVIDER)
        .flatMap((r) => (r.sourceRefs ?? []).filter((x) => x.provider === NCEI_PROVIDER).map((x) => x.externalId)),
    );
    const preexisting = records.filter(
      (r) => !(r.quality.provenance.length === 1 && r.quality.provenance[0] === NCEI_PROVIDER),
    );
    const { matched, unmatched: nearestMissed, rejected } = matchNcei(nceiRows, preexisting);

    // Rows whose pin was bound to its spring above. They missed the 200 m
    // radius by construction, so they arrive here unmatched; they join the
    // matches under the same one-row-per-spring rule matchNcei applies.
    const unmatchedAll = [];
    let coarseUsed = 0;
    for (const u of nearestMissed) {
      const b = coarseBindings.get(refKey(u.row));
      if (!b) {
        unmatchedAll.push(u);
        continue;
      }
      coarseUsed++;
      const clash = matched.findIndex((m) => m.id === b.into.id);
      if (clash >= 0) {
        const [other] = matched.splice(clash, 1);
        const reason = 'ambiguous: two NCEI rows contend for one spring';
        rejected.push({ row: u.row, id: b.into.id, meters: b.meters, reason });
        rejected.push({ row: { name: other.name, state: other.state }, id: other.id, meters: other.meters, reason });
        continue;
      }
      matched.push({
        id: b.into.id,
        meters: b.meters,
        name: u.row.name,
        state: u.row.state,
        celsius: u.row.celsius,
        qualitative: u.row.qualitative,
        via: 'coarse pin',
      });
    }
    if (coarseUsed !== coarseBound.length) {
      // A bound row the nearest-record matcher took elsewhere. Its pin is gone
      // and its row went to another spring, so say so rather than let the
      // count of bound pins overstate what happened.
      console.log(`  ${coarseBound.length - coarseUsed} bound NOAA row(s) were matched or refused at 200 m instead`);
    }

    // A row that became a pin is not "unmatched" in any sense a reader wants
    // counted as a miss. Naming the two apart is the whole point of the change.
    const becamePin = unmatchedAll.filter((u) => mintedHere.has(refKey(u.row)));
    const unmatched = unmatchedAll.filter((u) => !mintedHere.has(refKey(u.row)));

    const SOURCE_NOTE =
      'NOAA NCEI, Thermal Springs List for the United States (1981), doi:10.25921/c8p0-zs06';
    let filled = 0;
    let describedOnly = 0;
    const conflicts = [];

    let deferredToAuthor = 0;
    for (const m of matched) {
      const rec = byId.get(m.id);
      if (!rec) continue;
      // An authored claim wins, so do not write a value it is about to
      // replace. Skipping keeps `ncei` out of the provenance of a record where
      // nothing from NCEI survived.
      if (hasAuthoredTemperature(overlays.get(m.id))) {
        deferredToAuthor++;
        continue;
      }
      let touched = false;

      if (m.celsius !== null) {
        if (rec.temperature.celsius !== null) {
          // Never overwrite. Two upstreams disagreeing is a fact for the
          // report, not something to resolve by whichever ran last.
          if (rec.temperature.celsius !== m.celsius) {
            conflicts.push({
              id: m.id,
              name: rec.name,
              atlas: rec.temperature.celsius,
              ncei: m.celsius,
              meters: m.meters,
            });
          }
        } else {
          rec.temperature.celsius = m.celsius;
          rec.temperature.fahrenheit = Math.round(((m.celsius * 9) / 5 + 32) * 10) / 10;
          rec.temperature.measuredAt = '1981';
          rec.temperature.source = SOURCE_NOTE;
          filled++;
          touched = true;
        }
      } else if (m.qualitative && !rec.temperature.qualitative) {
        rec.temperature.qualitative = m.qualitative;
        rec.temperature.measuredAt = '1981';
        rec.temperature.source = SOURCE_NOTE;
        describedOnly++;
        touched = true;
      }

      if (!touched) continue;
      rec.quality.provenance = [...new Set([...rec.quality.provenance, 'ncei'])];
      if (rec.temperature.celsius !== null && !rec.quality.known.includes('temperature')) {
        rec.quality.known = [...rec.quality.known, 'temperature'];
      }
    }

    fs.writeFileSync(
      path.join('data', 'ncei-match-report.json'),
      `${JSON.stringify(
        {
          generatedAt: ingestedAt,
          counts: {
            rows: nceiRows.length,
            matched: matched.length,
            filled,
            describedOnly,
            deferredToAuthor,
            becamePin: becamePin.length,
            unmatched: unmatched.length,
            rejected: rejected.length,
            parseRejects: parseRejects.length,
            conflicts: conflicts.length,
          },
          conflicts,
          rejected,
          parseRejects,
          unmatched,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `  ${matched.length} matched, ${filled} temperature(s) filled, ` +
        `${describedOnly} described, ${deferredToAuthor} left to an author, ` +
        `${becamePin.length} became pins, ${unmatched.length} unmatched, ` +
        `${rejected.length} rejected -> data/ncei-match-report.json`,
    );
    if (conflicts.length) {
      console.log(`  ${conflicts.length} conflict(s) with an existing temperature, left alone`);
    }
  }

  // --- AIST / GSJ Japanese wellhead analyses ---
  // Enrichment only, and placed here for the same reason the NCEI merge is:
  // after identity, so ids are final, and before the curated overlay, so an
  // authored claim still wins. Nothing in this stage adds, moves or removes a
  // record -- AIST publishes a 187-191 m cell per row and a cell that wide in
  // a mountain valley is enough to put a pin on the wrong ravine, so the
  // centroid is a distance key and never a coordinate.
  const AIST_TSV = path.join('data', 'reference', 'aist-onsen.tsv');
  if (fs.existsSync(AIST_TSV)) {
    console.log('Merging AIST hot spring analyses ...');
    const aistRows = fromTsv(fs.readFileSync(AIST_TSV, 'utf8'));
    const { matched: aistMatched, rejected: aistRejected } = matchAist(aistRows, records);

    let aistTemps = 0;
    let aistChem = 0;
    let aistTypes = 0;
    const withheld = [];
    const aistReport = [];

    for (const m of aistMatched) {
      const rec = records.find((r) => r.id === m.id);
      if (!rec) continue;
      const overlay = overlays.get(m.id);
      const claimed = (field) => {
        const c = overlay?.claims?.[field];
        return Boolean(c) && c.state !== 'retracted';
      };
      const year = agreedYear(m.rows);
      const written = [];
      let touched = false;

      // The unit qualifies the whole panel, so it is decided BEFORE any figure
      // is written. A group whose wells were printed in different units, or in
      // none, has no commensurable panel to publish -- and writing figures
      // anyway is exactly what minerals.unit was added to prevent. Caught by
      // its own test rather than reasoned about: the first cut of this stage
      // wrote a chloride reading with unit null and the guard failed.
      const groupUnit = agreedUnit(m.rows);

      for (const [field, tolerance] of AIST_NUMERIC_FIELDS) {
        const value = agreedValue(m.rows, field, tolerance);
        if (field === 'celsius') {
          // Withheld rather than averaged when the wells disagree. Under one
          // onsen name they genuinely differ -- different depths, different
          // sources -- and picking one would publish a number nobody stated.
          if (value === null) { withheld.push({ id: m.id, field, reason: 'wells disagree or none stated' }); continue; }
          if (rec.temperature.celsius !== null || claimed('temperature.celsius')) continue;
          rec.temperature.celsius = value;
          rec.temperature.fahrenheit = Math.round(((value * 9) / 5 + 32) * 10) / 10;
          // AIST publishes 泉温 at the wellhead, so this is a source reading.
          rec.temperature.kind = 'source';
          rec.temperature.measuredAt = year;
          rec.temperature.source = AIST_SOURCE;
          aistTemps++; touched = true; written.push('temperature');
          continue;
        }
        // pH is unitless, so it is publishable whatever the panel's unit is.
        // Everything else needs one, and a figure whose unit the source did
        // not agree on is not a figure this atlas can render honestly.
        if (field !== 'ph' && !groupUnit) {
          withheld.push({ id: m.id, field, reason: 'no agreed unit for the panel' });
          continue;
        }
        if (value === null) { withheld.push({ id: m.id, field, reason: 'wells disagree or none stated' }); continue; }
        if (rec.minerals[field] !== null && rec.minerals[field] !== undefined) continue;
        if (claimed(`minerals.${field}`)) continue;
        rec.minerals[field] = value;
        touched = true; written.push(field);
      }

      // 泉質 -> minerals.types, fail-closed. The rules, and why a claim that
      // wins is still recorded as a contest, are on aistClassification.
      const types = aistClassification({
        springId: rec.id,
        senshitsu: [...new Set(m.rows.map((r) => r.senshitsu).filter(Boolean))],
        upstream: rec.minerals.types,
        claim: claimed('minerals.types') ? overlay.claims['minerals.types'] : null,
      });
      if (types.withheld) withheld.push({ id: m.id, field: 'types', reason: types.withheld });
      if (types.contest) sourceEvents.push(types.contest);
      if (types.write) {
        rec.minerals.types = types.write;
        aistTypes++; touched = true; written.push('types');
      }
      // Written only when something numeric that NEEDS a unit actually landed.
      // A unit beside no figures is decoration, and pH alone needs none.
      const wroteUnited = written.some((w) => w !== 'temperature' && w !== 'ph');
      if (wroteUnited && groupUnit && !claimed('minerals.unit')) rec.minerals.unit = groupUnit;
      if (written.some((w) => w !== 'temperature')) {
        if (!rec.minerals.measuredAt && !claimed('minerals.measuredAt')) rec.minerals.measuredAt = year;
        aistChem++;
      }

      if (touched) {
        if (!rec.quality.provenance.includes(AIST_PROVIDER)) {
          rec.quality.provenance = [...rec.quality.provenance, AIST_PROVIDER].sort();
        }
        rec.sources = [...new Set([...rec.sources, AIST_PAGE])];
      }
      aistReport.push({ id: m.id, name: rec.name, group: m.group, wells: m.rows.length,
                        meters: m.meters, agreement: m.agreement, written, measuredAt: year });
    }

    fs.writeFileSync(
      path.join('data', 'aist-match-report.json'),
      `${JSON.stringify({
        generatedAt: buildTimestamp,
        counts: {
          rows: aistRows.length,
          groupsMatched: aistMatched.length,
          temperaturesFilled: aistTemps,
          panelsFilled: aistChem,
          fieldsWithheld: withheld.length,
          groupsRejected: aistRejected.length,
        },
        matched: aistReport,
        withheld,
        rejected: aistRejected,
      }, null, 2)}\n`,
    );
    console.log(
      `  ${aistMatched.length} group(s) matched, ${aistTemps} temperature(s) filled, ` +
        `${aistChem} panel(s) filled, ${aistTypes} classification(s), ` +
        `${withheld.length} field(s) withheld, ` +
        `${aistRejected.length} contended -> data/aist-match-report.json`,
    );
  }

  // --- Water Quality Portal: US spring temperatures ---
  // Same slot as the other enrichments: after identity, so ids are final, and
  // above the curated overlay, so an authored claim still wins. Enrichment
  // only -- this stage never adds a record, because a WQP station is a
  // monitoring point rather than somewhere to bathe.
  const WQP_TSV = path.join('data', 'reference', 'wqp-spring-temps.tsv');
  if (fs.existsSync(WQP_TSV)) {
    console.log('Merging Water Quality Portal readings ...');
    const wqpRows = wqpFromTsv(fs.readFileSync(WQP_TSV, 'utf8'));
    const { matched: wqpMatched, withheld: wqpWithheld } = matchWqp(wqpRows, records);
    // Before the fill, so a spring is never compared with the reading this
    // stage is about to give it.
    const { corroborated: wqpCorroborated, conflicts: wqpConflicts } = compareWqp(wqpRows, records);

    let wqpFilled = 0;
    let wqpDeferred = 0;
    const wqpById = new Map(records.map((r) => [r.id, r]));
    for (const m of wqpMatched) {
      const rec = wqpById.get(m.id);
      if (!rec) continue;
      // An authored claim wins, so do not write a value the overlay is about
      // to replace -- that would leave `wqp` in the provenance of a record
      // where nothing from WQP survived.
      if (hasAuthoredTemperature(overlays.get(m.id))) { wqpDeferred++; continue; }
      if (rec.temperature.celsius !== null) continue;
      rec.temperature.celsius = m.celsius;
      rec.temperature.fahrenheit = Math.round(((m.celsius * 9) / 5 + 32) * 10) / 10;
      // USGS measures at the monitoring location, which for a spring site is
      // the spring itself.
      rec.temperature.kind = 'source';
      // The reading's own date, which is per-record and real -- unlike NOAA's
      // uniform 1981.
      rec.temperature.measuredAt = m.measuredAt ?? null;
      rec.temperature.source = `${WQP_SOURCE}, station ${m.station}`;
      rec.sources = [...new Set([...rec.sources, WQP_PAGE])];
      if (!rec.quality.provenance.includes(WQP_PROVIDER)) {
        rec.quality.provenance = [...rec.quality.provenance, WQP_PROVIDER].sort();
      }
      wqpFilled++;
    }

    fs.writeFileSync(
      path.join('data', 'wqp-match-report.json'),
      `${JSON.stringify({
        generatedAt: buildTimestamp,
        counts: {
          readings: wqpRows.length,
          matched: wqpMatched.length,
          filled: wqpFilled,
          deferredToAuthor: wqpDeferred,
          withheld: wqpWithheld.length,
          corroborated: wqpCorroborated.length,
          conflicts: wqpConflicts.length,
        },
        matched: wqpMatched,
        withheld: wqpWithheld,
        // A second measurement of a temperature the atlas already publishes.
        // Neither list changes a record: agreement is evidence, and a
        // disagreement is for a person to read, not for source order to settle.
        corroborated: wqpCorroborated,
        conflicts: wqpConflicts,
      }, null, 2)}\n`,
    );
    console.log(
      `  ${wqpMatched.length} matched, ${wqpFilled} temperature(s) filled, `
      + `${wqpWithheld.length} withheld, ${wqpCorroborated.length} corroborated, ${wqpConflicts.length} in conflict -> data/wqp-match-report.json`,
    );
  }

  // --- NBMG spring chemistry: Nevada and Colorado ---
  // Chemistry only, and enrichment only. No pin is minted and no temperature
  // is written: this source yields twelve temperatures against the atlas and
  // that seam is closed. Same slot as the other enrichments -- after identity,
  // above the curated overlay, so an authored claim still wins.
  const NBMG_TSV = path.join('data', 'reference', 'nbmg-spring-chemistry.tsv');
  if (fs.existsSync(NBMG_TSV)) {
    console.log('Merging NBMG spring chemistry ...');
    const nbmgRows = nbmgFromTsv(fs.readFileSync(NBMG_TSV, 'utf8'));
    const { matched: nbmgMatched, withheld: nbmgWithheld } = matchNbmg(nbmgRows, records);

    let nbmgPanels = 0;
    let nbmgFields = 0;
    let nbmgDeferred = 0;
    const nbmgById = new Map(records.map((r) => [r.id, r]));
    for (const m of nbmgMatched) {
      const rec = nbmgById.get(m.id);
      if (!rec) continue;
      const overlay = overlays.get(m.id);
      const claimed = (f) => Boolean(overlay?.claims?.[f]) && overlay.claims[f].state !== 'retracted';
      let wrote = 0;
      for (const [field, value] of Object.entries(m.values)) {
        if (claimed(`minerals.${field}`)) { nbmgDeferred++; continue; }
        if (rec.minerals[field] !== null && rec.minerals[field] !== undefined) continue;
        rec.minerals[field] = value;
        wrote++;
      }
      if (!wrote) continue;
      nbmgFields += wrote;
      nbmgPanels++;
      // Every column in this source names mg/L, so the unit is known rather
      // than inferred -- the question the AIST import needed a whole spec for
      // does not arise. pH is unitless and does not imply one on its own.
      const unitedWritten = Object.keys(m.values).some((f) => f !== 'ph');
      if (unitedWritten && !rec.minerals.unit && !claimed('minerals.unit')) rec.minerals.unit = 'mg/l';
      if (m.measuredAt && !rec.minerals.measuredAt && !claimed('minerals.measuredAt')) {
        rec.minerals.measuredAt = m.measuredAt;
      }
      rec.sources = [...new Set([...rec.sources, NBMG_PAGE])];
      if (!rec.quality.provenance.includes(NBMG_PROVIDER)) {
        rec.quality.provenance = [...rec.quality.provenance, NBMG_PROVIDER].sort();
      }
    }

    fs.writeFileSync(
      path.join('data', 'nbmg-match-report.json'),
      `${JSON.stringify({
        generatedAt: buildTimestamp,
        counts: {
          rows: nbmgRows.length,
          matched: nbmgMatched.length,
          panelsWritten: nbmgPanels,
          fieldsWritten: nbmgFields,
          deferredToAuthor: nbmgDeferred,
          withheld: nbmgWithheld.length,
        },
        matched: nbmgMatched,
        withheld: nbmgWithheld,
      }, null, 2)}\n`,
    );
    console.log(
      `  ${nbmgMatched.length} matched, ${nbmgPanels} panel(s) written, `
      + `${nbmgFields} field(s), ${nbmgWithheld.length} withheld -> data/nbmg-match-report.json`,
    );
  }

  // --- Curated overlay ---
  console.log('Applying curated claims ...');
  const { applied, orphaned, events: overlayEvents } = applyOverlays(records, overlays);
  console.log(`  ${applied} claim(s) applied from ${overlays.size} overlay file(s)`);
  const contested = [...sourceEvents, ...overlayEvents].filter((e) => e.type === 'claim.contested').length;
  if (contested) console.log(`  ${contested} claim(s) now disagree with upstream`);

  if (orphaned.length) {
    // A claim with nowhere to land is a correction about to vanish silently.
    console.error(`FATAL: ${orphaned.length} overlay file(s) reference springs absent from this build:`);
    for (const id of orphaned) console.error(`  ${id}`);
    console.error('Their claims would be silently discarded. Check data/registry.json for a');
    console.error('missingSince flag on these ids before removing the overlay files.');
    process.exit(1);
  }

  // --- Temperature warnings, reconciled ---
  // deriveWarnings ran at normalize time, when most of these records carried
  // no temperature at all. NCEI enrichment fills one in, and a curated claim
  // can set or correct it again -- and neither stage could reach the warning.
  // The result was 126 springs at 50C or above shipping with nothing beside
  // the number, the hottest at 110C, and the hole grew with every seeding
  // batch because seeding is exactly what adds temperatures late.
  //
  // This is the first point that sees the FINAL temperature, so it is where
  // the pair is brought back in line. It only rewrites the two derived
  // strings; it cannot add, move or remove a record, which is why it is safe
  // above the privacy filter.
  console.log('Reconciling temperature warnings ...');
  let rewarned = 0;
  for (const r of records) if (reconcileTemperatureWarnings(r)) rewarned++;
  console.log(`  ${rewarned} record(s) gained or lost a temperature warning`);

  // --- Pin accuracy, derived from who placed the point ---
  // Late, with the other derived fields, and for the same reason: dedupe can
  // merge an admitted NCEI pin into an OSM record and mergeInto adopts the
  // winner's coordinates. Stamped at mint time the 110 would outlive the
  // coordinate it described.
  //
  // Keyed on the refs that MINTED the point, never on quality.provenance.
  // 131 records carry ncei provenance while sitting on an OSM node -- springs
  // NOAA confirmed rather than placed -- and provenance cannot tell them apart.
  console.log('Deriving pin accuracy ...');
  let accuracySet = 0;
  for (const r of records) {
    reconcileAccuracy(r);
    if (r.location.accuracyMeters !== null) accuracySet++;
  }
  console.log(`  ${accuracySet} pin(s) state a precision; the rest are OSM and say nothing`);
  // --- Completeness, rescored ---
  // The same defect in the same shape, found by looking for it. NCEI
  // enrichment fills a temperature into an existing record and never
  // rescored, so 119 springs understated their completeness by exactly the
  // field they had just gained -- 33% showing where 50% was true. The overlay
  // stage rescored and the merge stage rescored; the enrichment stage between
  // them was the one that did not.
  //
  // Scoring here instead means the score is computed once, at the end, from
  // the record that actually ships. No future stage can fill a field and
  // forget, because there is no longer anywhere to forget it.
  console.log('Rescoring completeness ...');
  let rescored = 0;
  for (const r of records) {
    const c = completeness(r);
    if (c.score !== r.quality.completeness) rescored++;
    r.quality.completeness = c.score;
    r.quality.known = c.known;
  }
  console.log(`  ${rescored} record(s) had a stale completeness score`);

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
      sourceDate: generatedAt,
      count: records.length,
      ...licenceMetadata(),
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

  // --- Two counts, always together ---
  // Features are what mappers drew; sites are the places a visitor means. The
  // atlas publishes both and never one alone (docs/superpowers/specs/
  // 2026-09-23-counting-unit.md). The linking distance travels with them.
  const { siteOf, sites } = groupSites(records);

  const summary = {
    // The OSM snapshot this dataset was derived from -- NOT when the build
    // ran. buildTimestamp() takes the newest raw-tile mtime (or
    // SOURCE_DATE_EPOCH) precisely so a rebuild that changes nothing produces
    // no diff. The two dates diverge the moment you rebuild without
    // refetching, which is the normal case: curated claims land far more
    // often than OSM is refreshed.
    //
    // Named `generated` until it had drifted ten days from the build that
    // wrote it, while the About panel rendered it as "Dataset built <date>".
    // Both the field and the copy were asserting something untrue about data
    // whose whole premise is not doing that.
    sourceDate: generatedAt,
    total: records.length,
    sites: sites.length,
    siteLinkMeters: SITE_LINK_METERS,
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
    sitesByCountry: sitesByCountry(records, siteOf),
    droppedDuplicates: dropped,
    rejected: Object.fromEntries(rejects),
    excludedByPrivacyList: excluded,
    landManagerRestricted: Object.fromEntries(byManager),
  };
  fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));

  // --- Against the official count, where one exists ---
  const byIso = { features: {}, sites: {}, names: {} };
  const isoSites = {};
  for (const r of records) {
    const cc = r.location.country;
    byIso.features[cc] = (byIso.features[cc] ?? 0) + 1;
    byIso.names[cc] = r.location.countryName;
    (isoSites[cc] ??= new Set()).add(siteOf.get(r.id));
  }
  for (const [cc, set] of Object.entries(isoSites)) byIso.sites[cc] = set.size;
  const inventories = compileInventories(JSON.parse(fs.readFileSync(INVENTORIES, 'utf8')));
  const againstOfficial = compareWithInventories(inventories, byIso);
  fs.writeFileSync(OUT_COMPLETENESS, `${JSON.stringify({
    note: 'The atlas beside national counts published by a government. The units differ, so ratio is atlas / official between differently defined counts, not a percentage complete; each row says why. Sources and caveats: data/reference/official-inventories.json.',
    siteLinkMeters: SITE_LINK_METERS,
    rows: againstOfficial,
  }, null, 2)}\n`);
  fs.writeFileSync(REGISTRY, JSON.stringify(registry, null, 2) + '\n');
  const written = appendEvents(EVENTS, [...identityEvents, ...sourceEvents, ...overlayEvents], generatedAt);
  if (written) console.log(`  ${written} new event(s) recorded in ${EVENTS}`);

  console.log(`\n${records.length} features at ${sites.length} sites across ${summary.countries} countries`);
  for (const c of againstOfficial) {
    console.log(`  ${c.countryName}: ${c.atlas} ${c.comparesWith} beside ${c.official} ${c.unit} (${c.asOf}), ratio ${c.ratio}`);
  }
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

  console.log(`\nwrote ${OUT_JSON}, ${OUT_GEOJSON}, ${OUT_SUMMARY} (+ copies in public/data/), ${OUT_COMPLETENESS}`);
}

// Guarded so a test can import mergeInto without rebuilding the whole dataset
// as a side effect. `npm run data:build` runs this file directly, where
// import.meta.main is true.
//
// Checked rather than assumed: on a runtime without import.meta.main the guard
// is `undefined`, and the build would print nothing, exit 0, and leave
// yesterday's dataset in place looking like a success. A missing feature has
// to be an error, not a silent no-op.
if (typeof import.meta.main !== 'boolean') {
  throw new Error('node >=24.2 required: import.meta.main decides whether this file builds or is only imported');
}
if (import.meta.main) main();
