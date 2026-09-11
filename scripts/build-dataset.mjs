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
import { buildTimestamp, buildDate } from './lib/buildtime.mjs';
import { loadOverlays, applyOverlays } from './lib/overlay.mjs';
import { appendEvents } from './lib/events.mjs';
import { loadLandManagers, applyLandManagers } from './lib/land-manager.mjs';
import { parseNcei } from './lib/ncei.mjs';
import { matchNcei, hasAuthoredTemperature } from './lib/ncei-match.mjs';
import { classify, toRecord, refKey, NCEI_PROVIDER } from './lib/ncei-admit.mjs';
import { mineralTypesOf, classifySenshitsu } from './lib/senshitsu.mjs';
import { fromTsv, AIST_PROVIDER, AIST_SOURCE, AIST_PAGE } from './lib/aist.mjs';
import { matchAist, agreedValue, agreedUnit, agreedYear, NUMERIC_FIELDS as AIST_NUMERIC_FIELDS } from './lib/aist-match.mjs';

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
    const { matched, unmatched: unmatchedAll, rejected } = matchNcei(nceiRows, preexisting);

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

      // 泉質 -> minerals.types, fail-closed.
      //
      // The wells must agree on the RAW string before anything is read from
      // it. Two different classifications under one onsen name are two facts,
      // and reconciling them would publish a name nobody wrote.
      //
      // mineralTypesOf returns null when it could not account for every token.
      // That is not the same as [], and the difference is the whole rule: an
      // incomplete types array is indistinguishable from a complete one on the
      // card, so a value we only half understand publishes nothing.
      const senshitsu = [...new Set(m.rows.map((r) => r.senshitsu).filter(Boolean))];
      if (senshitsu.length > 1) {
        withheld.push({ id: m.id, field: 'types', reason: 'wells disagree on 泉質' });
      } else if (senshitsu.length === 1 && !rec.minerals.types.length && !claimed('minerals.types')) {
        const types = mineralTypesOf(senshitsu[0]);
        if (types === null) {
          withheld.push({
            id: m.id,
            field: 'types',
            reason: `泉質 not fully understood: ${JSON.stringify(classifySenshitsu(senshitsu[0]).residue)}`,
          });
        } else if (types.length) {
          rec.minerals.types = types;
          aistTypes++; touched = true; written.push('types');
        }
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

  // --- Curated overlay ---
  console.log('Applying curated claims ...');
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
