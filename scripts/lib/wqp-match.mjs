/**
 * Attaching a USGS/EPA spring reading to a spring this atlas already holds.
 *
 * Enrichment only: no pin is ever minted. WQP stations are monitoring points,
 * and the great majority are cold springs nobody would want in a hot-spring
 * atlas -- 1,597 of Nevada's 2,329 readings are below 20 C. What makes the
 * matched subset usable is that the atlas only ever asks about a location it
 * already calls a hot spring.
 *
 * CONTENTION RUNS BOTH WAYS, and the second direction is the one that
 * matters. The spec measured only the first and predicted 270 springs; with
 * both, the true figure is 40.
 *
 *   many stations, one spring   Great Boiling Spring has 17 stations within
 *                               200 m carrying 0 C to 100 C. It is a spring
 *                               field plus ambient measurements.
 *   one station, many springs   USGS-444353110422301 sits within 200 m of 21
 *                               atlas springs in Yellowstone, where OSM maps
 *                               individual vents. Copying one reading to 21
 *                               pins asserts 21 facts from one measurement.
 *
 * Either way the answer is to publish nothing. Under-importing is the error
 * this project prefers, and it is the same judgement ncei-match.mjs already
 * makes about NOAA groups versus OSM vents.
 */
import { distanceMeters } from './geo.mjs';

export const WQP_RADIUS_M = 200;

/**
 * How far two readings at ONE station may differ and still publish one number.
 *
 * This is not the AIST case of different wells under one name. It is the same
 * point measured repeatedly, sometimes decades apart, and a spring that ranges
 * more than a couple of degrees across its record is one no single figure
 * describes honestly.
 */
export const AGREEMENT_C = 2;

/**
 * Above this, a reading is not of liquid spring water at the surface.
 *
 * Water boils at 100 C at sea level and lower at altitude, where most of these
 * springs are. The mirror holds 8 readings above it out of 48,707 -- 111, 117,
 * 129, 185, 196, 262, 433 and 1,152 C -- and they are entry or unit errors:
 * the 433 C station sits 200 m from a spring NOAA put at 33 C. Dropped as
 * readings, so a station's sound readings can still agree without them.
 *
 * Not a cap on the atlas. A curated claim or another upstream may state a
 * superheated well or vent (Bad Blumau's 110 C well is one); this bounds what
 * a monitoring-station water sample can be.
 */
export const PLAUSIBLE_MAX_C = 100;

/** Cheap neighbourhood lookup: ~1.1 km cells, so a 200 m search needs 9. */
const CELL = 0.01;
const cellKey = (lat, lng) => `${Math.round(lat / CELL)}:${Math.round(lng / CELL)}`;

export function groupStations(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (!r.station || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
    if (!Number.isFinite(r.celsius)) continue;
    if (r.celsius > PLAUSIBLE_MAX_C) continue;
    if (!byId.has(r.station)) {
      byId.set(r.station, { id: r.station, name: r.name ?? null, lat: r.lat, lng: r.lng, readings: [] });
    }
    byId.get(r.station).readings.push({ celsius: r.celsius, measuredAt: r.measuredAt ?? null });
  }
  return byId;
}

/**
 * The reading to publish for a station, or null when its readings disagree.
 *
 * The most recent, not the mean -- which is computed -- and not the maximum,
 * which is cherry-picking in the direction that flatters a hot-spring atlas.
 * Undated readings sort last, so a dated figure is preferred over one whose
 * age is unknown.
 */
export function agreedReading(readings, tolerance = AGREEMENT_C) {
  const cs = readings.map((r) => r.celsius);
  if (!cs.length) return null;
  if (Math.max(...cs) - Math.min(...cs) > tolerance) return null;
  const sorted = [...readings].sort((a, b) => String(b.measuredAt ?? '').localeCompare(String(a.measuredAt ?? '')));
  return sorted[0];
}

/**
 * @returns {{matched: Array, withheld: Array}} `withheld` names every spring
 *   that had a station in range and did not get a number, and why. A silent
 *   miss and a deliberate refusal look identical in the output otherwise.
 */
export function matchWqp(rows, records, { radius = WQP_RADIUS_M, tolerance = AGREEMENT_C } = {}) {
  const stations = groupStations(rows);
  const grid = new Map();
  for (const st of stations.values()) {
    const k = cellKey(st.lat, st.lng);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(st);
  }

  const withheld = [];
  const pairs = [];
  for (const rec of records) {
    if (rec.temperature.celsius !== null) continue;
    const near = new Map();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get(cellKey(rec.location.lat + dy * CELL, rec.location.lng + dx * CELL));
        if (!bucket) continue;
        for (const st of bucket) {
          const d = distanceMeters(rec.location, st);
          if (d <= radius) near.set(st.id, { st, meters: Math.round(d) });
        }
      }
    }
    if (near.size === 0) continue;
    if (near.size > 1) {
      withheld.push({ id: rec.id, reason: `${near.size} stations within ${radius} m` });
      continue;
    }
    pairs.push({ rec, ...[...near.values()][0] });
  }

  // The second direction. Counted over the finished candidate set rather than
  // decided inline, because a station's claim only becomes ambiguous once
  // every spring has been considered.
  const claims = new Map();
  for (const p of pairs) claims.set(p.st.id, (claims.get(p.st.id) ?? 0) + 1);

  const matched = [];
  for (const p of pairs) {
    const shared = claims.get(p.st.id);
    if (shared > 1) {
      withheld.push({ id: p.rec.id, reason: `station ${p.st.id} is within ${radius} m of ${shared} springs` });
      continue;
    }
    const reading = agreedReading(p.st.readings, tolerance);
    if (!reading) {
      const cs = p.st.readings.map((r) => r.celsius);
      withheld.push({
        id: p.rec.id,
        reason: `station readings span ${(Math.max(...cs) - Math.min(...cs)).toFixed(1)} C`,
      });
      continue;
    }
    matched.push({
      id: p.rec.id,
      station: p.st.id,
      stationName: p.st.name,
      meters: p.meters,
      celsius: reading.celsius,
      measuredAt: reading.measuredAt,
      readings: p.st.readings.length,
    });
  }
  return { matched, withheld };
}

/**
 * Compare a station's reading with a temperature a spring ALREADY has. Writes
 * nothing; the build reports what this finds.
 *
 * A second independent measurement that agrees is corroboration, and it was
 * being thrown away: the fill pass above never looks at a spring that has a
 * value. One that disagrees is a fact for the report, not something to settle
 * by which source is newer -- measured on 2026-09-23, a large share of the
 * disagreeing stations are plainly not the spring (17 C at Kahneeta's 52,
 * 12 C at Horse Creek's 43): a creek or well inside the 200 m radius.
 *
 * Contention here counts EVERY spring near the station, unlike the fill pass.
 * Filling asks "may this reading go to a spring with no value?", and a
 * neighbour that already has one is not competing. Comparing asks "is this
 * reading OF this spring?", and a second spring in range means it may not be.
 *
 * @returns {{corroborated: Array, conflicts: Array}}
 */
export function compareWqp(rows, records, { radius = WQP_RADIUS_M, tolerance = AGREEMENT_C } = {}) {
  const stations = groupStations(rows);
  const grid = new Map();
  for (const st of stations.values()) {
    const k = cellKey(st.lat, st.lng);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(st);
  }
  const near = (rec) => {
    const found = new Map();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get(cellKey(rec.location.lat + dy * CELL, rec.location.lng + dx * CELL));
        if (!bucket) continue;
        for (const st of bucket) {
          const d = distanceMeters(rec.location, st);
          if (d <= radius) found.set(st.id, { st, meters: Math.round(d) });
        }
      }
    }
    return found;
  };

  const springsPerStation = new Map();
  const nearByRecord = new Map();
  for (const rec of records) {
    const found = near(rec);
    nearByRecord.set(rec, found);
    for (const id of found.keys()) springsPerStation.set(id, (springsPerStation.get(id) ?? 0) + 1);
  }

  const corroborated = [];
  const conflicts = [];
  for (const rec of records) {
    const atlas = rec.temperature.celsius;
    if (atlas === null) continue;
    const found = nearByRecord.get(rec);
    if (found.size !== 1) continue;
    const [{ st, meters }] = found.values();
    if (springsPerStation.get(st.id) > 1) continue;
    const reading = agreedReading(st.readings, tolerance);
    if (!reading) continue;
    const entry = {
      id: rec.id,
      name: rec.name ?? null,
      station: st.id,
      stationName: st.name,
      meters,
      atlas,
      atlasSource: rec.temperature.source ?? null,
      atlasMeasuredAt: rec.temperature.measuredAt ?? null,
      wqp: reading.celsius,
      wqpMeasuredAt: reading.measuredAt,
    };
    (Math.abs(atlas - reading.celsius) <= tolerance ? corroborated : conflicts).push(entry);
  }
  return { corroborated, conflicts };
}
