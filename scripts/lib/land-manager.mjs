/**
 * Land-manager restrictions: what the agency that owns the ground says.
 *
 * The atlas is built around finding places to bathe, and it hands every record
 * a Google Maps directions link. For features inside a national park that
 * prohibits entering thermal water, that combination is the whole hazard: the
 * app will route someone to a near-boiling pool with nothing on screen that
 * says not to get in. Yellowstone alone contributes over a thousand such
 * records, and 127 of them are named, developed-looking and carry no warning
 * of any kind, because `type === 'natural'` never triggers the `wild` notice.
 *
 * This layer is not a heuristic. It is a committed, reviewable list of
 * agency-published restrictions in data/land-managers.json, each with a source
 * URL and the date it was read, applied by bounding box. Reviewing a diff to
 * that file is reviewing the safety claim itself.
 *
 * Two deliberate choices:
 *
 *   Bounding boxes, not polygons. A generous box over-covers: it warns a
 *   spring just outside the park, which is merely cautious. A tight polygon
 *   that is slightly wrong under-covers, which kills someone. When the two
 *   errors are that asymmetric, take the cautious one. The cost is that the
 *   warning text must stay true of everything the box can reach — which is why
 *   the committed Yellowstone entry names the park and the tests pin the box
 *   to the park's extent.
 *
 *   The most restrictive match wins, not the last one listed. Overlapping
 *   entries are inevitable once this file grows (a park inside a forest inside
 *   a state). Ordering a JSON array must never be load-bearing for safety.
 */
import fs from 'node:fs';
import path from 'node:path';

export const LAND_MANAGERS_FILE = path.join('data', 'land-managers.json');

/** Mirrors AccessStatus in src/lib/types.ts. Ordered least to most restrictive. */
const STATUS_RANK = ['unknown', 'public', 'permit', 'view-only', 'closed'];

function fail(file, msg) {
  throw new Error(`${file}: ${msg}`);
}

/**
 * Load and fully validate the list. Throws on anything malformed.
 *
 * Every failure mode here is fatal rather than skip-and-continue. A land
 * manager that quietly fails to load is a set of springs published without
 * their restriction, which is precisely the outcome this file exists to
 * prevent — the same reasoning as loadExclusions().
 */
export function loadLandManagers(file = LAND_MANAGERS_FILE) {
  if (!fs.existsSync(file)) fail(file, 'not found. The land-manager list is required.');

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(file, `could not be parsed: ${err.message}`);
  }
  if (!Array.isArray(parsed)) fail(file, 'must be a JSON array of manager entries.');

  const seen = new Set();
  for (const m of parsed) {
    const where = `entry ${JSON.stringify(m?.id ?? '(no id)')}`;
    if (!m || typeof m !== 'object') fail(file, `${where} is not an object.`);
    for (const k of ['id', 'name', 'manager', 'warning', 'source', 'retrievedAt']) {
      if (typeof m[k] !== 'string' || !m[k].trim()) fail(file, `${where} has no ${k}.`);
    }
    if (seen.has(m.id)) fail(file, `${where} has a duplicate id.`);
    seen.add(m.id);

    if (!Array.isArray(m.bbox) || m.bbox.length !== 4 || !m.bbox.every(Number.isFinite)) {
      fail(file, `${where} needs a bbox of four numbers [minLng, minLat, maxLng, maxLat].`);
    }
    const [minLng, minLat, maxLng, maxLat] = m.bbox;
    // Catches the transposed [minLat, minLng, ...] ordering: a latitude
    // outside ±90 is impossible, and a park-sized box of longitudes will
    // always contain one. Without this a transposed bbox matches nothing and
    // the layer silently does nothing at all.
    if (Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) {
      fail(file, `${where} has a latitude outside ±90. Is the bbox transposed? Expected [minLng, minLat, maxLng, maxLat].`);
    }
    if (Math.abs(minLng) > 180 || Math.abs(maxLng) > 180) {
      fail(file, `${where} has a longitude outside ±180.`);
    }
    if (minLng >= maxLng || minLat >= maxLat) {
      fail(file, `${where} has an inverted or empty bbox.`);
    }

    const a = m.access;
    if (!a || typeof a !== 'object') fail(file, `${where} has no access block.`);
    if (!STATUS_RANK.includes(a.status)) {
      fail(file, `${where} has access.status ${JSON.stringify(a.status)}; expected one of ${STATUS_RANK.join(', ')}.`);
    }
    if (a.bathingAllowed !== null && typeof a.bathingAllowed !== 'boolean') {
      fail(file, `${where} has a non-boolean access.bathingAllowed.`);
    }
  }
  return parsed;
}

function contains(bbox, location) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const { lat, lng } = location;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

/** Every manager whose bbox contains the record, in file order. */
export function matchingManagers(record, managers) {
  return managers.filter((m) => contains(m.bbox, record.location));
}

/**
 * Apply the matching restrictions to each record, in place.
 *
 * Only ever tightens: `bathingAllowed` goes false the moment any match says
 * false, and the status settles on the most restrictive match. Warnings are
 * appended, never replaced, so an authored warning and an agency warning
 * coexist. Nothing here adds, removes, moves or reorders a record.
 *
 * Idempotent, and independent of the order of `managers`, so the build stays
 * byte-reproducible.
 */
export function applyLandManagers(records, managers) {
  let applied = 0;
  const byManager = new Map();

  for (const record of records) {
    const matches = matchingManagers(record, managers);
    if (!matches.length) continue;
    applied++;

    for (const m of matches) {
      byManager.set(m.id, (byManager.get(m.id) || 0) + 1);
      if (STATUS_RANK.indexOf(m.access.status) > STATUS_RANK.indexOf(record.access.status)) {
        record.access.status = m.access.status;
      }
      if (m.access.bathingAllowed === false) {
        record.access.bathingAllowed = false;
      } else if (m.access.bathingAllowed !== null && record.access.bathingAllowed === null) {
        record.access.bathingAllowed = m.access.bathingAllowed;
      }
      if (!record.warnings.includes(m.warning)) record.warnings.push(m.warning);
    }
  }

  return { records, applied, byManager };
}
