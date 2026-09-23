/**
 * One spring, two records: a coarse NOAA pin beside the OSM pin for the same
 * place.
 *
 * Pure: records in, bindings out. The build drops each bound pin and hands its
 * NOAA row to the NCEI enrichment stage as a match, so the row fills (or
 * contests) the OSM record under that stage's rules -- an authored claim wins,
 * nothing is overwritten, a disagreement is reported -- exactly as it would
 * have had NOAA printed the coordinate where OSM has it.
 *
 * WHY A SEPARATE RADIUS. NOAA's 1981 list prints three decimal places, which
 * reads as ~110 m and is what `accuracy.mjs` used to publish. It is the print
 * precision, not the error. Measured 2026-09-22 against OSM, over the 88 rows
 * whose distinctive name matches exactly one OSM record within 5 km:
 *
 *     median 129 m   p75 311 m   p90 495 m   p95 602 m   max 1,340 m
 *
 * and nothing at all between 1.4 and 5 km, which is what says the name match
 * is not catching coincidences. dedupe's EXACT_NAME_METERS (300 m) was set for
 * two OSM mappings of one feature and misses a quarter of these pairs; the
 * NCEI matcher's 200 m misses more. COARSE_PIN_METERS sits just past the
 * measured maximum. Re-measure before moving it.
 *
 * WHY THE NAME RULE IS STRICT. At 1.5 km, position is weak evidence, so the
 * name has to carry the identity on its own: equal after dropping only the
 * words the two sources disagree about writing (hot, warm, spring, springs,
 * the). Not containment -- "Blue Joint Hot Springs 2" is a different spring
 * from "Blue Joint Hot Springs", and "Glenwood Springs" is a town beside
 * "Glenwood Hot Springs Therapy Pool". Missing a real pair leaves a duplicate
 * that is visible and fixable; a wrong bind puts a 1981 temperature on the
 * wrong spring, which nobody would see.
 *
 * Ambiguity is a refusal, as in ncei-match.mjs: a pin with two candidates, or
 * two pins wanting one record, binds nothing.
 */
import { distanceMeters } from './geo.mjs';
import { NCEI_PROVIDER } from './ncei-admit.mjs';

export const COARSE_PIN_METERS = 1500;

/** Words one source writes and the other leaves out. Nothing else is dropped. */
const QUALIFIERS = new Set(['hot', 'warm', 'spring', 'springs', 'the']);

/** A name reduced to what identifies the place; '' when nothing does. */
export function identityName(name) {
  const words = String(name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((w) => !QUALIFIERS.has(w)).join(' ');
}

/** Shorter than this and a name identifies nothing at 1.5 km. */
const MIN_IDENTITY_LENGTH = 3;

/** A pin NOAA minted and nothing else has touched. */
export function isCoarsePin(record) {
  const p = record.quality.provenance;
  return p.length === 1 && p[0] === NCEI_PROVIDER;
}

/** The NOAA row key a minted pin carries, or null. */
export function nceiRefOf(record) {
  return (record.sourceRefs ?? []).find((r) => r.provider === NCEI_PROVIDER)?.externalId ?? null;
}

/**
 * @returns {{
 *   bound: {pin: object, into: object, meters: number}[],
 *   refused: {pin: object, meters: number, reason: string}[],
 * }}
 */
export function findCoarseDuplicates(records) {
  const pins = records.filter(isCoarsePin);
  const precise = records.filter((r) => !isCoarsePin(r));

  // Index the precise side by identity name; pins are few and names are rare,
  // so this is a handful of distance computations rather than 7M.
  const byName = new Map();
  for (const r of precise) {
    const k = identityName(r.name);
    if (k.length < MIN_IDENTITY_LENGTH) continue;
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }

  const candidates = [];
  const refused = [];
  for (const pin of pins) {
    const k = identityName(pin.name);
    if (k.length < MIN_IDENTITY_LENGTH) continue;
    const near = (byName.get(k) ?? [])
      .map((into) => ({ into, meters: distanceMeters(pin.location, into.location) }))
      .filter((c) => c.meters <= COARSE_PIN_METERS);
    if (near.length === 0) continue;
    if (near.length > 1) {
      const meters = Math.round(Math.min(...near.map((c) => c.meters)));
      refused.push({ pin, meters, reason: 'ambiguous: two records share the name within range' });
      continue;
    }
    candidates.push({ pin, into: near[0].into, meters: Math.round(near[0].meters) });
  }

  const byTarget = new Map();
  for (const c of candidates) byTarget.set(c.into, [...(byTarget.get(c.into) ?? []), c]);
  const bound = [];
  for (const group of byTarget.values()) {
    if (group.length > 1) {
      for (const c of group) {
        refused.push({ pin: c.pin, meters: c.meters, reason: 'ambiguous: two NOAA pins want one record' });
      }
      continue;
    }
    bound.push(group[0]);
  }
  return { bound, refused };
}
