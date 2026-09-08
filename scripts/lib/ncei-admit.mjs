/**
 * Which NOAA rows may become springs in this atlas.
 *
 * Pure: a row and the manager list in, a verdict out. The rules and their
 * reasoning are in
 * docs/superpowers/specs/2026-09-08-ncei-stage-two-admission.md.
 *
 * The posture throughout is under-import. This is name-only classification
 * against a table with no type column, so it will miss some; shipping a
 * fumarole as a hot spring is the error that matters.
 */

/**
 * A view-only feature word, as a WHOLE word. Substring matching is wrong in
 * this direction and measured to be: STEAMBOAT SPRINGS contains "STEAM",
 * FORT BIDWELL contains "WELL", WHITE SULPHUR SPRINGS contains "SULPHUR".
 */
const VIEW =
  /\b(FUMAROLE|FUMAROLES|GEYSER|GEYSERS|MUDPOT|MUDPOTS|MUDKETTLE|PAINTPOT|PAINTPOTS|SOLFATARA)\b|\b(MUD|STEAM|GAS|PAINT)\s+(POT|POTS|VENT|VENTS|VOLCANO|VOLCANOES|CAVE|CAVES)\b/i;

/**
 * A water word. A name claiming a spring or pool is soak-class even when it
 * also names the geyser next door -- HOT SPRINGS NEAR GEYSER BIGHT. Measured:
 * without this clause 13 real springs are lost.
 */
const WATER = /\b(SPRING|SPRINGS|POOL|POOLS|LAGOON|BATHS?|HOT\s+WELLS?)\b/i;

/** A name made only of these identifies no particular spring. */
const GENERIC = /^(HOT|WARM|THERMAL)?\s*(SPRING|SPRINGS|POOL|POOLS|SEEP|SEEPS)?\s*(\(HOT\)|\(WARM\))?$/i;

/** Degrees of precision below which a pin is not safe to publish. ~110 m. */
export const MIN_DECIMAL_PLACES = 3;

function decimals(v) {
  const s = String(v);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * Read the MANAGER LIST, never a record's access.bathingAllowed.
 *
 * Admission runs above the land-manager stage, so at this point that field is
 * null on every record and testing it would silently admit every park row.
 * Same flag, same intent, sourced from the config that already carries it.
 */
function inNoBathing(row, managers) {
  return managers.some((m) => {
    if (m?.access?.bathingAllowed !== false) return false;
    const [minLng, minLat, maxLng, maxLat] = m.bbox;
    return row.lng >= minLng && row.lng <= maxLng && row.lat >= minLat && row.lat <= maxLat;
  });
}

/**
 * Rules run in a fixed order so a row carries exactly one reason, and the
 * cheaper, more specific one wins. A generic name inside a park is reported as
 * generic, because that is the fact about the row rather than about where it
 * happens to sit.
 */
export function classify(row, managers) {
  const name = (row.name ?? '').trim();
  if (name && VIEW.test(name) && !WATER.test(name)) {
    return { admit: false, reason: 'view-only feature' };
  }
  if (!name || GENERIC.test(name)) {
    return { admit: false, reason: 'generic or absent name' };
  }
  if (Math.min(decimals(row.lat), decimals(row.lng)) < MIN_DECIMAL_PLACES) {
    return { admit: false, reason: 'coordinates coarser than 3 dp' };
  }
  if (inNoBathing(row, managers)) {
    return { admit: false, reason: 'inside a no-bathing boundary' };
  }
  return { admit: true };
}
