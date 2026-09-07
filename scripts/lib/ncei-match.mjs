/**
 * Bind NCEI rows to springs the atlas already holds.
 *
 * Pure: records in, dispositions out.
 *
 * 200 m and the name rule were measured together against the real datasets
 * before either was written down: at 200 m, 70% of pairs where both sides are
 * named share a name, decaying to 63% by 500 m and 59% by 1 km. Changing the
 * radius without re-measuring the agreement rate breaks the pairing that
 * justifies it.
 *
 * Ambiguity is a rejection, never a tie-break. Where two NCEI rows contend for
 * one spring -- the Yellowstone group-versus-vent case, where NOAA lists named
 * groups and OSM lists individual vents -- neither is applied. Under-importing
 * is the right error: attaching a group's temperature to a single vent would
 * be silently wrong, and silently wrong is the failure this project spends the
 * most effort avoiding.
 */
import { distanceMeters, normName } from './geo.mjs';

export const MATCH_RADIUS_M = 200;

/**
 * Containment, not equality: "Bijah Spring" and "Bijah Springs" are one place.
 * The substring hazard that bit the dedupe pass ("No. 4" matching "No. 4b") is
 * bounded here by the radius, which dedupe did not have.
 */
function namesAgree(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return true; // one side unnamed is not a disagreement
  return x.includes(y) || y.includes(x);
}

export function matchNcei(nceiRows, atlasRecords) {
  const candidates = [];
  const rejected = [];
  const unmatched = [];

  for (const row of nceiRows) {
    let best = null;
    let bestD = Infinity;
    for (const rec of atlasRecords) {
      const d = distanceMeters({ lat: row.lat, lng: row.lng }, rec.location);
      if (d < bestD) {
        bestD = d;
        best = rec;
      }
    }
    if (!best || bestD > MATCH_RADIUS_M) {
      unmatched.push({ row, nearestMeters: Number.isFinite(bestD) ? Math.round(bestD) : null });
      continue;
    }
    if (!namesAgree(row.name, best.name)) {
      rejected.push({ row, id: best.id, meters: Math.round(bestD), reason: 'name disagreement' });
      continue;
    }
    candidates.push({ row, id: best.id, meters: Math.round(bestD) });
  }

  // Contention is resolved by rejecting everyone, so this must be a second pass
  // over the finished candidate set rather than a decision taken inline.
  const byId = new Map();
  for (const c of candidates) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);

  const matched = [];
  for (const [id, group] of byId) {
    if (group.length > 1) {
      for (const c of group) {
        rejected.push({
          row: c.row,
          id,
          meters: c.meters,
          reason: 'ambiguous: two NCEI rows contend for one spring',
        });
      }
      continue;
    }
    const { row, meters } = group[0];
    matched.push({
      id,
      meters,
      name: row.name,
      state: row.state,
      celsius: row.celsius,
      qualitative: row.qualitative,
    });
  }

  return { matched, unmatched, rejected };
}
