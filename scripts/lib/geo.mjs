/**
 * Geographic and name-comparison helpers shared across the pipeline.
 *
 * These existed as three separate copies with two different signatures, which
 * is exactly how a 60m rule in one file and a 60m rule in another quietly stop
 * meaning the same thing. One definition, imported everywhere.
 */

const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in metres between two {lat, lng} points. */
export function distanceMeters(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Normalise a name for comparison: lowercase, strip everything that is not a
 * letter or a number in any script.
 *
 * The Unicode property escapes matter. A naive [^a-z0-9] would reduce every
 * Japanese and Arabic name to the empty string, and empty names compare equal
 * to each other, which would merge every unnamed spring in Japan into one.
 */
export function normName(n) {
  return (n || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
