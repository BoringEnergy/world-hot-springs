/**
 * Attaching an NBMG analysis to a spring the atlas already holds.
 *
 * Enrichment only, chemistry only. No pin is minted and no temperature is
 * written: this source yields twelve temperatures and that seam is closed.
 *
 * CONTENTION RUNS BOTH WAYS, written in from the start rather than
 * discovered. The Water Quality Portal matcher checked only one direction on
 * its first cut and published one reading to 21 Yellowstone springs; adding
 * the second took it from 142 matches to 40.
 */
import { distanceMeters } from './geo.mjs';
import { PANEL } from './nbmg.mjs';

export const NBMG_RADIUS_M = 200;

/**
 * How far two analyses of the same spring may differ and still publish one
 * figure. AIST's absolute tolerances, not a percentage.
 *
 * Measured: 5% was the placeholder in the findings and is LOOSER than this,
 * not tighter -- Nevada falls from 100 springs to 96 under these numbers,
 * because 5% of a 2,000 mg/L chloride reading is 100 mg/L of slack and 1 mg/L
 * is not.
 */
export const TOLERANCE = { ph: 0.1, iron: 0.1 };
export const DEFAULT_TOLERANCE = 1;

const CELL = 0.01;
const key = (lat, lng) => `${Math.round(lat / CELL)}:${Math.round(lng / CELL)}`;

/**
 * Mirror rows to one entry per sampling POINT, carrying every reading.
 *
 * Keyed on the published position rather than on SamplingFeatureURI, which
 * looks like the obvious key and is the wrong one. Colorado issues a separate
 * feature URI per analysis: 39.54944,-107.32167 carries TEN of them --
 * `COHS_ 34_1`, `COHS_ 34_2`, and so on -- alongside a URI literally derived
 * from the coordinate, `cogs:39.54944-107.32167`. Those are repeated samples
 * of one spring, not ten springs zero metres apart.
 *
 * Keyed by URI they became ten competing sites and tripped the contention
 * rule, costing 11 of 109 springs. 67 positions in the mirror carry more than
 * one URI, all of them Colorado.
 *
 * Five decimal places is about a metre, so two features sharing a key are the
 * same point rather than neighbours.
 */
export function groupSites(rows) {
  const sites = new Map();
  for (const r of rows) {
    if (!r.site || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
    const id = `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`;
    if (!sites.has(id)) {
      sites.set(id, { id, uris: new Set(), name: r.name ?? null, state: r.state ?? null, lat: r.lat, lng: r.lng, readings: {}, years: [] });
    }
    const s = sites.get(id);
    s.uris.add(r.site);
    s.name ??= r.name ?? null;
    if (r.measuredAt) s.years.push(String(r.measuredAt));
    for (const f of PANEL) {
      const v = r[f];
      if (typeof v === 'number' && Number.isFinite(v)) (s.readings[f] ??= []).push(v);
    }
  }
  return sites;
}

/**
 * The value to publish for one field, or null when its readings disagree.
 *
 * Never averaged. Where several analyses agree, the figure published is one
 * they all support, so taking the first is taking a number somebody measured
 * rather than one this code computed.
 */
export function agreedValue(values, field) {
  if (!values?.length) return null;
  const tol = TOLERANCE[field] ?? DEFAULT_TOLERANCE;
  if (Math.max(...values) - Math.min(...values) > tol) return null;
  return values[0];
}

/**
 * @returns {{matched, withheld}} `withheld` names every spring that had a
 *   site in range and got nothing, with the reason. A silent miss and a
 *   deliberate refusal are otherwise indistinguishable in the output.
 */
export function matchNbmg(rows, records, { radius = NBMG_RADIUS_M } = {}) {
  const sites = groupSites(rows);
  const grid = new Map();
  for (const s of sites.values()) {
    const k = key(s.lat, s.lng);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  }

  const withheld = [];
  const pairs = [];
  for (const rec of records) {
    // Only springs with no chemistry at all. A record that already holds a
    // panel is not this stage's business, and mixing two sources' analyses
    // into one card would publish a panel nobody measured.
    if (PANEL.some((f) => rec.minerals[f] !== null && rec.minerals[f] !== undefined)) continue;
    const near = new Map();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get(key(rec.location.lat + dy * CELL, rec.location.lng + dx * CELL));
        if (!bucket) continue;
        for (const s of bucket) {
          const d = distanceMeters(rec.location, s);
          if (d <= radius) near.set(s.id, { site: s, meters: Math.round(d) });
        }
      }
    }
    if (near.size === 0) continue;
    if (near.size > 1) {
      withheld.push({ id: rec.id, reason: `${near.size} chemistry sites within ${radius} m` });
      continue;
    }
    pairs.push({ rec, ...[...near.values()][0] });
  }

  // The second direction, counted once the candidate set is complete: a
  // site's claim is only ambiguous after every spring has been considered.
  const claims = new Map();
  for (const p of pairs) claims.set(p.site.id, (claims.get(p.site.id) ?? 0) + 1);

  const matched = [];
  for (const p of pairs) {
    const shared = claims.get(p.site.id);
    if (shared > 1) {
      withheld.push({ id: p.rec.id, reason: `one site is within ${radius} m of ${shared} springs` });
      continue;
    }
    const values = {};
    const disagreed = [];
    for (const [field, vs] of Object.entries(p.site.readings)) {
      const v = agreedValue(vs, field);
      if (v === null) disagreed.push(field); else values[field] = v;
    }
    if (!Object.keys(values).length) {
      withheld.push({ id: p.rec.id, reason: `every field disagrees across analyses: ${disagreed.join(', ')}` });
      continue;
    }
    matched.push({
      id: p.rec.id,
      site: p.site.id,
      siteName: p.site.name,
      meters: p.meters,
      values,
      withheldFields: disagreed,
      // The most recent year any analysis at this site states. The panel can
      // combine analyses, so this dates the newest rather than claiming they
      // were all taken together.
      measuredAt: p.site.years.length ? [...p.site.years].sort().at(-1) : null,
    });
  }
  return { matched, withheld };
}
