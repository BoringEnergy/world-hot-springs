/**
 * The privacy guard.
 *
 * This is the one part of the pipeline that exists to make the dataset smaller.
 * If a spring is known only to locals and the people who care for it don't want
 * it publicised, it does not go on the map — not blurred, not offset, not
 * listed without coordinates. Off.
 *
 * The exclusion list lives at data/private/exclusions.json, which is gitignored
 * and never published. That is deliberate: publishing a list of the places we
 * deliberately hid would defeat the entire point. The list is matched by OSM id
 * and by geographic radius, so a spring stays excluded even if it is re-mapped
 * under a new id.
 *
 * Format (data/private/exclusions.json):
 * {
 *   "entries": [
 *     { "osmId": "node/123456789", "reason": "owner request 2026-03" },
 *     { "lat": 64.123, "lng": -21.456, "radiusMeters": 2000, "reason": "local community request" }
 *   ]
 * }
 */
import fs from 'node:fs';
import path from 'node:path';
import { distanceMeters } from './geo.mjs';

const LIST = path.join('data', 'private', 'exclusions.json');

export function loadExclusions() {
  if (!fs.existsSync(LIST)) return { entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(LIST, 'utf8'));
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    console.log(`  privacy: ${entries.length} exclusion rule(s) loaded (contents never logged)`);
    return { entries };
  } catch (err) {
    // Fail loud and stop. A malformed exclusion list must never be treated as
    // an empty one — that would publish exactly what it was meant to protect.
    console.error(`FATAL: ${LIST} exists but could not be parsed: ${err.message}`);
    console.error('Refusing to build a dataset without a readable exclusion list.');
    process.exit(1);
  }
}

export function isExcluded(record, exclusions) {
  for (const e of exclusions.entries) {
    if (e.osmId && record.id === `osm-${e.osmId.replace('/', '-')}`) return true;
    if (typeof e.lat === 'number' && typeof e.lng === 'number') {
      const radius = typeof e.radiusMeters === 'number' ? e.radiusMeters : 1000;
      if (distanceMeters(record.location, { lat: e.lat, lng: e.lng }) <= radius) return true;
    }
    if (e.namePattern && record.name && new RegExp(e.namePattern, 'i').test(record.name)) return true;
  }
  return false;
}
