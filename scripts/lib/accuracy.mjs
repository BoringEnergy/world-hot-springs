/**
 * How precisely a pin is placed, derived from WHO PLACED IT.
 *
 * The distinction this exists to keep: accuracy describes who wrote
 * `location.lat`/`lng`, not who later attached a temperature or a chemistry
 * panel. Four upstreams now write to this atlas and only two of them have
 * ever minted a coordinate.
 *
 *   OSM node or way   somebody stood at the spring -- null, render nothing
 *   NCEI-admitted     about 500 m -- measured, not read off the decimals
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
 * How far a NOAA pin sits from the spring, measured -- not the precision it
 * is printed to.
 *
 * This was 110 m until 2026-09-22, read off NOAA's three decimal places. That
 * is print precision. Measured against OSM over the 88 rows whose distinctive
 * name matches exactly one OSM record within 5 km (the measurement is in
 * coarse-pins.mjs): median 129 m, p90 495 m, p95 602 m, max 1,340 m. "Located
 * to about 110 m" was true of half the pins and told a reader to trust the
 * other half five times too much.
 *
 * 500 m is the 90th percentile: nine pins in ten are nearer than that. The
 * sample is springs OpenStreetMap also maps, which leans toward well-known
 * ones; an obscure spring's pin is no better and may be worse.
 *
 * One figure for every pin, still, because nothing in a row says which pins
 * are the good ones; a per-record value would imply knowledge nobody has.
 */
export const NCEI_ACCURACY_M = 500;

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
