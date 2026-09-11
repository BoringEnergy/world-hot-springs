/**
 * How precisely a pin is placed, derived from WHO PLACED IT.
 *
 * The distinction this exists to keep: accuracy describes who wrote
 * `location.lat`/`lng`, not who later attached a temperature or a chemistry
 * panel. Four upstreams now write to this atlas and only two of them have
 * ever minted a coordinate.
 *
 *   OSM node or way   somebody stood at the spring -- null, render nothing
 *   NCEI-admitted     three decimal places, about 110 m
 *   AIST              NEVER a pin. Its 190 m cell is a match key and is
 *                     documented as one; stamping 190 on a Japanese OSM
 *                     record it merely enriched would attribute the
 *                     publisher's fuzzing to a point OSM placed precisely
 *   WQP, NBMG         enrichment only, so the pin is whatever placed it
 *
 * Derived LATE, from the finished record, for the same reason the
 * temperature warnings are: dedupe can merge an admitted NCEI pin into an
 * OSM record and `mergeInto` adopts the winner's coordinates. Six records are
 * in exactly that state. Stamped at mint time the 110 would survive a merge
 * that replaced the coordinate it described.
 */
import { NCEI_PROVIDER } from './ncei-admit.mjs';

/**
 * NCEI's own admission floor is three decimal places, and ncei-admit.mjs puts
 * the number on it: "~110 m". Every one of the 1,023 minted pins is at
 * exactly 3 dp, so a per-record derivation would return the same value 1,023
 * times and imply a precision the uniformity does not support.
 */
export const NCEI_ACCURACY_M = 110;

/**
 * Never invent a figure for OpenStreetMap. "A node is about 5-10 m" is a
 * measurement nobody made, and null is the honest answer for a point whose
 * precision the source never stated.
 */
export function accuracyMetersOf(record) {
  // An OSM ref means OpenStreetMap placed this point -- including on the six
  // records that carry an NCEI ref as well, where dedupe merged an admitted
  // pin into an OSM one.
  if ((record.osmRefs ?? []).length > 0) return null;
  const refs = record.sourceRefs ?? [];
  if (refs.some((r) => r.provider === NCEI_PROVIDER)) return NCEI_ACCURACY_M;
  return null;
}

/**
 * @returns {boolean} whether the record's accuracy changed.
 */
export function reconcileAccuracy(record) {
  const next = accuracyMetersOf(record);
  const changed = record.location.accuracyMeters !== next;
  record.location.accuracyMeters = next;
  return changed;
}
