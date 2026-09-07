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
 * Words that identify no particular spring. A name made only of these carries
 * no information, so it must never be used as evidence that two records are
 * the same place.
 */
const GENERIC = new Set(['hot', 'warm', 'spring', 'springs', 'pool', 'pools', 'the', 'and', 'of']);

const words = (n) => String(n ?? '').toLowerCase().match(/\p{L}+/gu) ?? [];
const isGeneric = (n) => { const w = words(n); return w.length > 0 && w.every((x) => GENERIC.has(x)); };

/** Drop the qualifier that one source writes and the other does not. */
const withoutQualifier = (n) => normName(String(n ?? '').replace(/\b(hot|warm)\b/gi, ' '));

function contains(x, y) {
  return x.includes(y) || y.includes(x);
}

/**
 * Containment, not equality: "Bijah Spring" and "Bijah Springs" are one place.
 * The substring hazard that bit the dedupe pass ("No. 4" matching "No. 4b") is
 * bounded here by the radius, which dedupe did not have.
 *
 * The second pass exists because "hot" is optional in American spring names and
 * is often interpolated into the middle of one of them: WILBUR SPRINGS and
 * Wilbur Hot Springs are one place, and plain containment fails on nothing but
 * that word. Dropping it recovers seven real pairs.
 *
 * It is guarded, because dropping the qualifier can reduce a name to nothing
 * distinctive. "SPRING (HOT)" becomes "spring", which is a substring of nearly
 * every spring name there is; unguarded, it would match whatever happened to be
 * nearest and attach NOAA's reading to a different spring. Measured, not
 * imagined: it did exactly that to Gila / Lightfeather at 59 m.
 *
 * A name generic on BOTH sides is a different case and still agrees. Neither
 * carries information, so the match rests on proximity alone -- which is how
 * two unnamed springs are already treated.
 */
function namesAgree(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return true; // one side unnamed is not a disagreement
  if (contains(x, y)) return true;
  if (isGeneric(a) || isGeneric(b)) return false;
  const sx = withoutQualifier(a);
  const sy = withoutQualifier(b);
  if (!sx || !sy) return false;
  return contains(sx, sy);
}

/**
 * Has an author already claimed this spring's temperature?
 *
 * The NCEI stage runs before the overlay, so "the atlas has no temperature yet"
 * is not the same question as "nobody has claimed one". Without this, NOAA
 * fills a value the overlay is about to overwrite -- harmless in the output,
 * but it leaves `ncei` in the record's provenance when nothing from NCEI
 * survived, which is a claim about where the data came from that is not true.
 */
export function hasAuthoredTemperature(overlay) {
  const claim = overlay?.claims?.['temperature.celsius'];
  return Boolean(claim) && claim.state !== 'retracted';
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
