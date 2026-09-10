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
import { deriveWarnings, completeness } from './normalize.mjs';

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

export const NCEI_PROVIDER = 'ncei';

export const NCEI_SOURCE =
  'NOAA NCEI, Thermal Springs List for the United States (1981), doi:10.25921/c8p0-zs06';

/**
 * `sources` is a list of URLs -- DetailPanel renders each as <a href={src}>.
 * The citation string above belongs on temperature.source, which is rendered
 * as text; put it here and the card grows a link to nowhere.
 */
export const NCEI_DOI_URL = 'https://doi.org/10.25921/c8p0-zs06';

/**
 * The reading is 45 years old and so is the claim that the spring exists. A
 * record nobody has visited should say so on its own card, not only in a
 * provenance field a reader has to go looking for.
 */
export const NCEI_HISTORICAL_WARNING =
  'Recorded in a 1981 federal compilation and not been checked on the ground since. ' +
  'The temperature, and the existence of this spring, are historical.';

/**
 * The row's identity within its provider, and it must survive a re-fetch.
 * The mirror has no id column, so the key is what the TSV prints: the file is
 * pinned by sha256 and regenerated deterministically, so these strings are
 * stable as long as the pin is.
 */
export function refKey(row) {
  return `${row.state}/${row.lat}/${row.lng}`;
}

/** A NOAA row as a full HotSpring, ready to enter the pipeline before dedupe. */
export function toRecord(row, ingestedAt) {
  const celsius = row.celsius;
  const warnings = [...deriveWarnings({}, celsius, 'natural'), NCEI_HISTORICAL_WARNING];
  const record = {
    // Provisional. resolveRegistry replaces it with the minted whs_ id, which
    // it derives from sourceRefs below.
    id: `${NCEI_PROVIDER}:${refKey(row)}`,
    sourceRefs: [{ provider: NCEI_PROVIDER, externalId: refKey(row) }],
    name: row.name,
    location: {
      lat: row.lat,
      lng: row.lng,
      elevation: null,
      country: 'US',
      countryName: 'United States of America',
      region: row.state,
      nearestTown: null,
    },
    temperature: {
      celsius,
      fahrenheit: celsius === null ? null : Math.round(((celsius * 9) / 5 + 32) * 10) / 10,
      source: NCEI_SOURCE,
      measuredAt: '1981',
      qualitative: row.qualitative,
      kind: 'source',
    },
    access: { price: null, currency: null, notes: null, status: 'unknown', bathingAllowed: null },
    clothing: { policy: 'unknown', schedule: null, notes: null },
    hours: { open: null, seasonalNotes: null, status: 'unknown' },
    minerals: {
      ph: null,
      tds: null,
      sulfate: null,
      bicarbonate: null,
      chloride: null,
      calcium: null,
      magnesium: null,
      sodium: null,
      potassium: null,
      silica: null,
      iron: null,
      types: [],
      notes: null,
      measuredAt: null,
      unit: null,
    },
    type: 'natural',
    unicorn: false,
    verified: false,
    lastVerified: ingestedAt,
    sources: [NCEI_DOI_URL],
    description: null,
    tags: [],
    warnings,
    quality: { provenance: [NCEI_PROVIDER], completeness: 0, known: [], ingestedAt },
    osmRefs: [],
  };

  // Scored the same way and by the same function as an OSM record.
  // normalizeElement does this at the end of its build; left undone, an
  // admitted record reads "0% complete" on a card that is showing a
  // temperature, a name and a type.
  const c = completeness(record);
  record.quality.completeness = c.score;
  record.quality.known = c.known;
  return record;
}
