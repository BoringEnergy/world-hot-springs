/**
 * Sites: features grouped into the places a visitor means by "a hot spring".
 *
 * Pure: records in, groups out. Accepted 2026-09-23
 * (docs/superpowers/specs/2026-09-23-counting-unit.md): the atlas always
 * publishes two counts, features (every record, what a mapper drew) and sites.
 *
 * A site is the records linked by a chain of neighbours each within
 * SITE_LINK_METERS (single-linkage), by position alone. Measured on 7,130
 * features there is no natural break -- 5,229 groups at 100 m, 4,735 at 250 m,
 * 4,462 at 500 m, 4,256 at 1 km -- so 500 m is a convention and is published
 * beside the number it produces. Below 250 m the pools and vents of one spring
 * are still being split; past 500 m chains begin to join separate places
 * along a valley.
 *
 * Names play no part. A name rule would reopen every question dedupe closed,
 * and a site is a place whatever its parts are called.
 */
import { distanceMeters } from './geo.mjs';

export const SITE_LINK_METERS = 500;

/**
 * Grid cells in degrees. A cell must be at least one link wide in BOTH
 * directions, or a pair straddling two non-adjacent cells is never compared.
 * A degree of longitude shrinks toward the poles: 0.01 is 487 m at Iceland's
 * 64 N, too narrow for 500 m. 0.05 is still 580 m of longitude at 84 N, past
 * every spring there is (Svalbard's Troll springs are at 79 N).
 */
const CELL = 0.05;

/**
 * @returns {{ siteOf: Map<string, number>, sites: string[][] }} `sites` lists
 *   each site's record ids; site numbers are assigned in order of each site's
 *   first record in `records`, so the grouping is deterministic.
 */
export function groupSites(records, linkMeters = SITE_LINK_METERS) {
  const parent = records.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // Scaled up for a longer link than the one CELL was sized for.
  const cell = CELL * Math.max(1, linkMeters / SITE_LINK_METERS);
  const grid = new Map();
  const cellOf = (r) => [Math.floor(r.location.lat / cell), Math.floor(r.location.lng / cell)];
  records.forEach((r, i) => {
    const k = cellOf(r).join(':');
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });

  records.forEach((r, i) => {
    const [a, b] = cellOf(r);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of grid.get(`${a + dy}:${b + dx}`) ?? []) {
          if (j <= i) continue;
          if (distanceMeters(r.location, records[j].location) <= linkMeters) union(i, j);
        }
      }
    }
  });

  const numberOf = new Map();
  const sites = [];
  const siteOf = new Map();
  records.forEach((r, i) => {
    const root = find(i);
    if (!numberOf.has(root)) {
      numberOf.set(root, sites.length);
      sites.push([]);
    }
    const n = numberOf.get(root);
    sites[n].push(r.id);
    siteOf.set(r.id, n);
  });
  return { siteOf, sites };
}

/**
 * Sites per country, by country name. A site that straddles a border counts in
 * each country it touches, so these can sum to more than the total; the total
 * counts every site once.
 */
export function sitesByCountry(records, siteOf) {
  const seen = new Map();
  for (const r of records) {
    const name = r.location.countryName;
    if (!seen.has(name)) seen.set(name, new Set());
    seen.get(name).add(siteOf.get(r.id));
  }
  return Object.fromEntries([...seen].map(([name, set]) => [name, set.size]).sort((a, b) => b[1] - a[1]));
}
