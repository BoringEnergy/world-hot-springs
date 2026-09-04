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
 * The provider every id in the committed registry was minted from.
 *
 * Named rather than inlined because "osm" appears here as a value in the data,
 * not as a fact about this file: the projection below, mintId's compatibility
 * seam and any future provider check must agree on the same spelling.
 */
export const OSM_PROVIDER = 'osm';

/** The ordering key. `provider:externalId`, so the OSM subset stays sorted by ref. */
const sourceRefKey = (ref) => `${ref.provider}:${ref.externalId}`;

/**
 * Mint a stable id from a source reference.
 *
 * Hash-derived rather than sequential so that ids are reproducible: rebuilding
 * from scratch on another machine assigns the same id to the same spring.
 *
 * An OSM ref is hashed BARE -- `node/1078652088`, never `osm:node/1078652088`.
 * This is a permanent compatibility seam, not a transitional one. All 6,471
 * committed ids were hashed from a bare `type/id`, so namespacing the input
 * moves every one of them:
 *
 *   mintId({provider: 'osm', externalId: 'node/1078652088'})  -> whs_8448a909f48b
 *   sha256('osm:node/1078652088')                             -> whs_917056fb7fd7
 *
 * Every overlay file is named for a spring id and validated against the
 * published dataset, so a moving id orphans every authored claim at once --
 * the only layer here that cannot be rebuilt. Every other provider IS
 * namespaced, so two inventories that happen to share an externalId stay two
 * springs.
 */
export function mintId({ provider, externalId }) {
  const input = provider === OSM_PROVIDER ? externalId : sourceRefKey({ provider, externalId });
  return `whs_${createHash('sha256').update(input).digest('hex').slice(0, 12)}`;
}

/**
 * Which of a record's refs the id is minted from.
 *
 * Not array order. Once a record can carry several refs -- an OSM node that
 * also cites Wikidata -- whichever ref lands first would decide the id, and
 * that would be decided by the order of `record.sources`, which no contract
 * guarantees.
 *
 * Prefer OSM, so every id that exists today keeps the input it was minted
 * from; otherwise the lexicographically lowest `provider:externalId`.
 *
 * Among *several* OSM refs the first one refsOf yields wins, rather than the
 * lowest. That looks like the weaker rule and is the load-bearing one:
 * measured against the committed registry, 70 of the 738 multi-ref entries
 * were minted from an OSM ref that is not their lexicographically lowest
 * (whs_2e84822fe59f holds ['node/12723737139', 'way/303218726'] and was minted
 * from the way). Sorting here would move all 70 on the next bootstrap. That
 * ambiguity predates providers and is not this rule's to resolve.
 */
export function mintRef(refs) {
  const osm = refs.find((r) => r.provider === OSM_PROVIDER);
  if (osm) return osm;
  return refs.reduce((lowest, r) => (sourceRefKey(r) < sourceRefKey(lowest) ? r : lowest));
}

/**
 * A registry source reference is `{provider, externalId}` and deliberately
 * nothing else.
 *
 * The design note's SourceRef is richer -- it also carries `url`, `license`
 * and `retrievedAt` -- and the next reader will expect that shape here. It
 * does not belong here. Those three describe where a *fact* came from and
 * belong on the record beside the fact they justify; the registry's only job
 * is deciding which spring a record is, and a licence string cannot help with
 * that. Copied in, they would be a second place for provenance to drift from.
 */
function toSourceRef({ provider, externalId }) {
  return { provider, externalId };
}

/**
 * `osmRefs` is a projection of `sourceRefs`, never a second authored copy.
 *
 * Two writable copies of one fact is the divergence that already bit
 * `access.price` in this repository. Everything downstream -- the published
 * records, the events log, the existing tests -- still reads `osmRefs`, so it
 * stays; it is just derived now.
 */
function osmRefsOf(sourceRefs) {
  return sourceRefs.filter((r) => r.provider === OSM_PROVIDER).map((r) => r.externalId);
}

/**
 * Merge refs into an entry's, deduplicated by `provider:externalId` and sorted.
 *
 * Default string order, not localeCompare: collation treats punctuation
 * loosely, and the OSM projection of this list is written to disk and compared
 * byte for byte against what the pre-sourceRefs code produced with a bare
 * `.sort()`.
 */
function mergeSourceRefs(existing, incoming) {
  const byKey = new Map();
  for (const ref of [...existing, ...incoming]) byKey.set(sourceRefKey(ref), toSourceRef(ref));
  return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, ref]) => ref);
}

/**
 * Read a registry, from disk or from a caller's own object, into the shape the
 * resolver works in.
 *
 * All 6,471 committed entries predate `sourceRefs` and hold only `osmRefs`, so
 * the refs are synthesised back out of the projection: every one of them is an
 * OSM ref, because `osmRefs` could never have held anything else. Order is
 * preserved rather than sorted -- an entry read and written unchanged must come
 * back byte-identical, and sorting here would silently rewrite any entry whose
 * refs were not already in order.
 *
 * `resolveRegistry` applies this to whatever it is handed, so a caller that
 * parses `registry.json` itself still gets the synthesis. One reader, one path.
 */
export function loadRegistry(raw) {
  const registry = {};
  for (const [whsId, entry] of Object.entries(raw)) {
    const sourceRefs = (
      entry.sourceRefs ?? (entry.osmRefs ?? []).map((externalId) => ({ provider: OSM_PROVIDER, externalId }))
    ).map(toSourceRef);
    registry[whsId] = { ...structuredClone(entry), osmRefs: osmRefsOf(sourceRefs), sourceRefs };
  }
  return registry;
}

/**
 * Every source reference a record can be traced to, including merged
 * duplicates. `{provider, externalId}`, the same shape the registry stores.
 *
 * OSM is still the only provider anything produces, but the refs are qualified
 * here rather than at the point of use so that the index key, the mint input
 * and the stored ref are one value with one provider on it. Qualifying late is
 * how `wikidata:Q4115712` and a bare `Q4115712` from another inventory would
 * mint two ids and still collide on one index key.
 *
 * A record whose id is not OSM-shaped contributes no ref -- never a
 * synthesised one. An id is a merge key here, and a key invented for a record
 * that has none is a key every such record shares.
 *
 * Order is meaningful: the record's own ref comes first, and mintRef reads
 * that order to pick between several OSM refs.
 */
function refsOf(record) {
  const externalIds = new Set();
  const own = osmRefOf(record.id);
  if (own) externalIds.add(own);
  for (const src of record.sources || []) {
    const m = src.match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/);
    if (m) externalIds.add(`${m[1]}/${m[2]}`);
  }
  return [...externalIds].map((externalId) => ({ provider: OSM_PROVIDER, externalId }));
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
 *   1. any source ref the record can be traced to
 *   2. isSameSpring against existing entries, which survives a redraw under a
 *      new OSM id
 *   3. mint a new id
 *
 * @returns {{registry: object, assignments: Map<string,string>, events: object[]}}
 */
export function resolveRegistry(records, existingRegistry, today) {
  const registry = loadRegistry(existingRegistry);
  const assignments = new Map();
  const events = [];

  // Keyed on `provider:externalId`, never on the bare externalId. Two
  // providers that happen to share an externalId mint two different ids; on a
  // bare key they would collide here instead, and the second record would
  // resolve onto the first's entry and never reach minting at all -- a merge
  // that mintId alone can neither cause nor detect.
  const byRef = new Map();
  for (const [whsId, entry] of Object.entries(registry)) {
    for (const ref of entry.sourceRefs) byRef.set(sourceRefKey(ref), whsId);
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
    let whsId = refs.map((r) => byRef.get(sourceRefKey(r))).find(Boolean);

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
      if (!refs.length) {
        // No ref means no mint input. mintId now understands providers, but
        // it needs one: a record whose id is `usgs:P96Q13U3` declares no
        // sourceRefs, and refsOf will not invent a provider for it -- a
        // guessed provider is a guessed id, and an id that later moves
        // orphans every overlay file named for it. Records carry their own
        // sourceRefs before a non-OSM source can be ingested.
        throw new Error(
          `${record.id} yields no source ref, so it cannot be given a durable id. ` +
            'Non-OSM sources need the provider-aware mintId; see ' +
            'docs/superpowers/specs/2026-09-03-source-independent-identity.md',
        );
      }
      // Which ref, by rule rather than by array order -- see mintRef.
      const ref = mintRef(refs);
      whsId = mintId(ref);
      // Guards against a hash collision, not any expected condition: two
      // different source refs minting the same id would silently conflate two
      // distinct springs under one durable id. That is worse than a crash.
      if (registry[whsId]) {
        const existing = registry[whsId];
        throw new Error(
          `mintId collision on ${whsId}: ` +
            // sourceRefs, not osmRefs: for an entry with no OSM ref the
            // projection is empty, and the loudest error in the system would
            // print nothing precisely when the input space is widest.
            `existing ref(s) ${existing.sourceRefs.map(sourceRefKey).join(', ')} ` +
            `at centroid ${JSON.stringify(existing.centroid)} ` +
            `vs new ref ${sourceRefKey(ref)} at centroid ${JSON.stringify([record.location.lng, record.location.lat])}`,
        );
      }
      registry[whsId] = {
        osmRefs: [],
        sourceRefs: [],
        centroid: [record.location.lng, record.location.lat],
        name: record.name,
        firstSeen: today,
        lastSeen: today,
        missingSince: null,
      };
      events.push({ type: 'spring.appeared', springId: whsId, actor: 'build' });
    }

    const entry = registry[whsId];
    entry.sourceRefs = mergeSourceRefs(entry.sourceRefs, refs);
    entry.osmRefs = osmRefsOf(entry.sourceRefs);
    entry.centroid = [record.location.lng, record.location.lat];
    entry.name = record.name ?? entry.name;
    entry.lastSeen = today;
    entry.missingSince = null;

    for (const ref of entry.sourceRefs) byRef.set(sourceRefKey(ref), whsId);
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
