/**
 * Durable spring identity.
 *
 * `osm-node-123` is stable only while that OSM node exists. Nodes get deleted
 * and redrawn, and an orphaned claim is a correction somebody lost. Springs
 * therefore carry an id of ours, resolved against a committed registry.
 */
import { createHash } from 'node:crypto';
import { distanceMeters, normName } from './geo.mjs';

/** Different element types within this radius are one feature mapped twice. */
export const SAME_FEATURE_METERS = 60;
/** Two anonymous records must be practically on top of each other to merge. */
export const ANONYMOUS_METERS = 12;
/** An identical name this far apart is one destination mapped as several pools. */
export const EXACT_NAME_METERS = 300;
/**
 * Below this normalised length, a substring match is weak evidence on its
 * own and needs distance to make up the difference.
 *
 * This is about evidence, not character count. normName strips spaces and
 * punctuation, so short numbered/labelled names collide by coincidence:
 * "No. 4" -> "no4" and "No. 4b" -> "no4b" are two distinct numbered pools
 * at one site, measured 62m apart in the real dataset -- just outside
 * SAME_FEATURE_METERS, saved from merging only by luck. But a short name is
 * not inherently a fragment: "風の湯" and "大湯" are complete, meaningful
 * three- and two-character Japanese names, and Arabic and Chinese names are
 * similarly compact. Treating "short" as "incomplete" would wrongly split
 * genuine CJK/Arabic duplicates that happen to sit right on top of each
 * other.
 *
 * So instead of excluding short names from the substring branch, they stay
 * eligible but only within ANONYMOUS_METERS -- the radius already reserved
 * for cases with no name to go on. At a few metres apart, near-coincident
 * position supplies the identity evidence the short name can't; at tens of
 * metres, it's coincidence. Exact-equality matching is unaffected at any
 * length or distance up to EXACT_NAME_METERS.
 */
export const MIN_SUBSTRING_NAME_LENGTH = 4;

/**
 * The only id shape an OSM reference can be read out of.
 *
 * Deliberately strict. A loose split was how `osmRefOf('usgs:P96Q13U3')` came
 * to return the string 'undefined/undefined' -- a single merge key shared by
 * every record that is not from OSM, and `resolveRegistry` matches on refs
 * before it looks at position or name. Anything this pattern does not match
 * has no OSM identity, and saying so is the whole point.
 */
const OSM_ID = /^osm-(node|way|relation)-(\d+)$/;

/** 'osm-node-123' -> 'node'; null for an id that is not OSM-shaped. */
export function osmType(id) {
  return OSM_ID.exec(id)?.[1] ?? null;
}

/** 'osm-node-123' -> 'node/123'; null for an id that is not OSM-shaped. */
export function osmRefOf(id) {
  const m = OSM_ID.exec(id);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** No answer at all -- not a kind that merely differs from the others. */
export const KIND_UNKNOWN = 'unknown';

/**
 * Point or area? -- the question the named/unnamed branch is really asking.
 *
 * Today an OSM element type is the only thing that answers it, so the answer
 * is derived from the id. `kind` is the seam a non-OSM source will fill in
 * directly, once records carry one; until then nothing sets it.
 */
function featureKind(record) {
  return record.kind ?? osmType(record.id) ?? KIND_UNKNOWN;
}

/**
 * Are these two records the same physical spring?
 *
 * Erring toward "no" is the safer failure. A leftover duplicate is visible and
 * fixable; a wrong merge silently deletes a real spring.
 */
export function isSameSpring(a, b) {
  const d = distanceMeters(a.location, b.location);
  const an = normName(a.name);
  const bn = normName(b.name);

  if (an && bn) {
    if (an === bn) return d <= EXACT_NAME_METERS;
    // A substring match is weaker evidence ("Blue Spring" vs "Blue Spring
    // Lodge"), so it keeps the tight radius -- unless one of the names is
    // short enough that the match itself is weak evidence (see
    // MIN_SUBSTRING_NAME_LENGTH), in which case only near-coincident
    // position can make up for it.
    if (!(an.includes(bn) || bn.includes(an))) return false;
    const shortName = an.length <= MIN_SUBSTRING_NAME_LENGTH || bn.length <= MIN_SUBSTRING_NAME_LENGTH;
    // Same evidentiary logic that justifies ANONYMOUS_METERS: weak identity
    // evidence needs strong positional evidence to make up for it.
    const WEAK_EVIDENCE_METERS = ANONYMOUS_METERS;
    return d <= (shortName ? WEAK_EVIDENCE_METERS : SAME_FEATURE_METERS);
  }

  // One named, one not: the source-and-pool case, which shows up as two
  // different element types. Same type means two features somebody mapped
  // individually, so leave them alone.
  if (an || bn) {
    if (d > SAME_FEATURE_METERS) return false;
    const ka = featureKind(a);
    const kb = featureKind(b);
    // Two unknowns are not "different kinds", and an unknown next to a node is
    // not evidence of a pool around it. Left to `undefined !== 'node'` the
    // absence of an answer would read as the strongest possible one, and this
    // branch merges -- which deletes one of the two springs. Refuse, and let a
    // human resolve the duplicate that survives.
    if (ka === KIND_UNKNOWN || kb === KIND_UNKNOWN) return false;
    return ka !== kb;
  }

  return d <= ANONYMOUS_METERS;
}

/**
 * Mint a stable id from an OSM reference.
 *
 * Hash-derived rather than sequential so that ids are reproducible: rebuilding
 * from scratch on another machine assigns the same id to the same spring.
 */
export function mintId(osmRef) {
  return `whs_${createHash('sha256').update(osmRef).digest('hex').slice(0, 12)}`;
}

/**
 * Every OSM reference a record can be traced to, including merged duplicates.
 *
 * A record whose id is not OSM-shaped contributes no ref -- never a
 * synthesised one. An id is a merge key here, and a key invented for a record
 * that has none is a key every such record shares.
 */
function refsOf(record) {
  const refs = new Set();
  const own = osmRefOf(record.id);
  if (own) refs.add(own);
  for (const src of record.sources || []) {
    const m = src.match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/);
    if (m) refs.add(`${m[1]}/${m[2]}`);
  }
  return [...refs];
}

/**
 * Spatial index over registry centroids, so the fallback match scans a handful
 * of neighbours instead of all 6,471 entries.
 *
 * Measured before this existed: 31ms for an ordinary rebuild where everything
 * matches by OSM ref and the fallback barely runs, but 4.45s to bootstrap an
 * empty registry and 12.8s if every ref changed at once. Phase 2 runs this on
 * every pull request, so the worst case is the one that matters.
 */
const CELL_DEG = 0.01;
/** The widest distance isSameSpring can ever match at. Nothing beyond it matters. */
const SEARCH_RADIUS_M = EXACT_NAME_METERS;
const METERS_PER_DEG_LAT = 111_320;

const cellKey = (latCell, lngCell) => `${latCell}:${lngCell}`;

function buildGrid(registry) {
  const grid = new Map();
  for (const [id, entry] of Object.entries(registry)) {
    const [lng, lat] = entry.centroid;
    const key = cellKey(Math.floor(lat / CELL_DEG), Math.floor(lng / CELL_DEG));
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(id);
  }
  return grid;
}

/**
 * Registry ids whose centroid could be within SEARCH_RADIUS_M of a point.
 *
 * Longitude cells narrow toward the poles, so the number of columns to scan is
 * computed from the latitude rather than fixed. At 89°N a 0.01° column is about
 * 19m wide, and scanning a fixed ±1 would miss matches 300m away — the kind of
 * bug that only ever shows up in Svalbard.
 */
function nearbyIds(grid, { lat, lng }) {
  const latSpan = Math.ceil(SEARCH_RADIUS_M / (CELL_DEG * METERS_PER_DEG_LAT));
  const metersPerDegLng = Math.max(1, Math.cos((lat * Math.PI) / 180) * METERS_PER_DEG_LAT);
  const lngSpan = Math.min(
    Math.ceil(SEARCH_RADIUS_M / (CELL_DEG * metersPerDegLng)),
    // Past this the whole latitude band is closer than the radius; scanning
    // every column is correct and cheap, because so few entries live there.
    Math.ceil(360 / CELL_DEG),
  );

  const latCell = Math.floor(lat / CELL_DEG);
  const lngCell = Math.floor(lng / CELL_DEG);
  const ids = [];
  for (let dy = -latSpan; dy <= latSpan; dy++) {
    for (let dx = -lngSpan; dx <= lngSpan; dx++) {
      const bucket = grid.get(cellKey(latCell + dy, lngCell + dx));
      if (bucket) ids.push(...bucket);
    }
  }
  return ids;
}

/**
 * A registry entry rendered as something isSameSpring can compare.
 *
 * An entry with no OSM ref used to be handed over as 'node/0', so the matcher
 * saw a confident `point` where there was no answer at all -- and an unnamed
 * entry would then merge with any named way within SAME_FEATURE_METERS. Say
 * unknown instead, and let isSameSpring refuse.
 */
function asComparable(whsId, entry) {
  const [lng, lat] = entry.centroid;
  const ref = entry.osmRefs[0];
  const [type, num] = ref ? ref.split('/') : [];
  return {
    id: ref ? `osm-${type}-${num}` : whsId,
    kind: ref ? type : KIND_UNKNOWN,
    name: entry.name,
    location: { lat, lng },
    whsId,
  };
}

/**
 * Assign a durable id to every record and update the registry.
 *
 * Matching order:
 *   1. any OSM ref the record can be traced to
 *   2. isSameSpring against existing entries, which survives a redraw under a
 *      new OSM id
 *   3. mint a new id
 *
 * @returns {{registry: object, assignments: Map<string,string>, events: object[]}}
 */
export function resolveRegistry(records, existingRegistry, today) {
  const registry = structuredClone(existingRegistry);
  const assignments = new Map();
  const events = [];

  const byRef = new Map();
  for (const [whsId, entry] of Object.entries(registry)) {
    for (const ref of entry.osmRefs) byRef.set(ref, whsId);
  }

  // Spatial index over the registry so the fallback scans neighbours rather
  // than every entry. Built once and never rebuilt, which is sound because an
  // entry is added to `seen` in the same step that moves its centroid, and the
  // fallback skips everything in `seen` -- so no un-scanned entry ever moves.
  const grid = buildGrid(registry);
  // Insertion order, so the bucketed scan returns the same match the old
  // linear scan did when several entries qualify.
  const order = new Map(Object.keys(registry).map((id, i) => [id, i]));

  const seen = new Set();

  for (const record of records) {
    const refs = refsOf(record);
    let whsId = refs.map((r) => byRef.get(r)).find(Boolean);

    if (!whsId) {
      let best = null;
      let bestOrder = Infinity;
      for (const id of nearbyIds(grid, record.location)) {
        if (seen.has(id) || order.get(id) >= bestOrder) continue;
        if (isSameSpring(asComparable(id, registry[id]), record)) {
          best = id;
          bestOrder = order.get(id);
        }
      }
      whsId = best ?? undefined;
    }

    if (!whsId) {
      // An OSM ref is the mint input wherever one exists, forever: every id in
      // the committed registry was hashed from a bare `type/id` and renaming
      // one orphans every claim filed against it. A record with no OSM ref has
      // only its own id to be minted from, which holds until mintId learns
      // about providers.
      whsId = mintId(refs[0] ?? record.id);
      // Guards against a hash collision, not any expected condition: two
      // different OSM refs minting the same id would silently conflate two
      // distinct springs under one durable id. That is worse than a crash.
      if (registry[whsId]) {
        const existing = registry[whsId];
        throw new Error(
          `mintId collision on ${whsId}: ` +
            `existing ref(s) ${existing.osmRefs.join(', ')} at centroid ${JSON.stringify(existing.centroid)} ` +
            `vs new ref ${refs[0] ?? record.id} at centroid ${JSON.stringify([record.location.lng, record.location.lat])}`,
        );
      }
      registry[whsId] = {
        osmRefs: [],
        centroid: [record.location.lng, record.location.lat],
        name: record.name,
        firstSeen: today,
        lastSeen: today,
        missingSince: null,
      };
      events.push({ type: 'spring.appeared', springId: whsId, actor: 'build' });
    }

    const entry = registry[whsId];
    entry.osmRefs = [...new Set([...entry.osmRefs, ...refs])].sort();
    entry.centroid = [record.location.lng, record.location.lat];
    entry.name = record.name ?? entry.name;
    entry.lastSeen = today;
    entry.missingSince = null;

    for (const ref of entry.osmRefs) byRef.set(ref, whsId);
    seen.add(whsId);
    assignments.set(record.id, whsId);
  }

  // Entries nothing matched are flagged, never removed. One plausible cause of
  // an upstream disappearance is a privacy removal we should honour, and a
  // second is a mapper error we should notice. Both need a human.
  for (const [whsId, entry] of Object.entries(registry)) {
    if (seen.has(whsId) || entry.missingSince) continue;
    entry.missingSince = today;
    events.push({ type: 'spring.disappeared', springId: whsId, actor: 'build' });
  }

  return { registry, assignments, events };
}
