/**
 * The Water Quality Portal: USGS/EPA spring temperatures.
 *
 * Reasoning, measurements and the two decisions this implements are in
 * docs/superpowers/specs/2026-09-11-wqp-us-upstream.md.
 *
 * The parser is imported from aist.mjs rather than written again. This
 * repository has now been bitten twice by a second copy of one fact --
 * the completeness scorer, and the TSV numeric-column list -- and a fourth
 * RFC4180 reader would be the same mistake with better manners.
 */
import { parseCsv } from './aist.mjs';

export const WQP_PROVIDER = 'wqp';

export const WQP_SOURCE =
  'US Water Quality Portal (USGS/EPA/NWQMC), waterqualitydata.us, siteType=Spring';

export const WQP_PAGE = 'https://www.waterqualitydata.us/';

/**
 * The grid, fixed and committed.
 *
 * Derived once from every US spring in the atlas at 2-degree resolution, then
 * FROZEN. Deriving it at fetch time from the current dataset would mean the
 * query set changed whenever the atlas did, and a snapshot whose own scope
 * moves is not a snapshot of anything.
 *
 * Tiles rather than states because the API's latency is fixed per query, not
 * proportional to what comes back: a statewide California request ran past
 * seven minutes without answering, while a tile returning five stations takes
 * the same sixty seconds as one returning a thousand.
 */
export const TILES = [
  [18, -156], [20, -160], [22, -160], [26, -84], [28, -106], [28, -104], [28, -96],
  [30, -114], [30, -112], [30, -110], [30, -106], [30, -102],
  [32, -120], [32, -118], [32, -116], [32, -114], [32, -112], [32, -110], [32, -108], [32, -106], [32, -94], [32, -86],
  [34, -122], [34, -120], [34, -118], [34, -116], [34, -114], [34, -112], [34, -110], [34, -108], [34, -106], [34, -94], [34, -84],
  [36, -124], [36, -122], [36, -120], [36, -118], [36, -116], [36, -114], [36, -112], [36, -110], [36, -108], [36, -106], [36, -82], [36, -80],
  [38, -124], [38, -122], [38, -120], [38, -118], [38, -116], [38, -114], [38, -112], [38, -110], [38, -108], [38, -106], [38, -80], [38, -78],
  [40, -124], [40, -122], [40, -120], [40, -118], [40, -116], [40, -114], [40, -112], [40, -110], [40, -108], [40, -88], [40, -76], [40, -74],
  [42, -124], [42, -122], [42, -120], [42, -118], [42, -116], [42, -114], [42, -112], [42, -110], [42, -108], [42, -106], [42, -104], [42, -74],
  [44, -124], [44, -122], [44, -120], [44, -118], [44, -116], [44, -114], [44, -112], [44, -110],
  [46, -124], [46, -122], [46, -120], [46, -116], [46, -114], [46, -112], [46, -110],
  [48, -122], [48, -120],
  [50, -178], [52, -178], [52, -176], [52, -174], [52, -170], [52, -168],
  [54, -164], [54, -162], [54, -134], [54, -132],
  [56, -158], [56, -138], [56, -136], [56, -134], [56, -132], [58, -138], [58, -136],
  [60, -162], [60, -158], [60, -152], [62, -152], [62, -146],
  [64, -166], [64, -156], [64, -154], [64, -152], [64, -150], [64, -148], [64, -146], [64, -144],
  [66, -158], [66, -156], [66, -154], [66, -150], [68, -148],
];

const BASE = 'https://www.waterqualitydata.us/data';
const FILTERS = 'siteType=Spring&characteristicName=Temperature%2C%20water&mimeType=csv&zip=no';

/** `bBox` is west,south,east,north -- longitude FIRST, which is the reverse of
 * how every other coordinate in this repository is written. */
export function tileUrl(kind, [lat, lng]) {
  const box = `${lng},${lat},${lng + 2},${lat + 2}`;
  return `${BASE}/${kind}/search?bBox=${box}&${FILTERS}`
    + (kind === 'Result' ? '&dataProfile=narrowResult' : '');
}

function indexer(header) {
  const at = new Map(header.map((h, i) => [h, i]));
  return (row, name) => {
    const i = at.get(name);
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
}

/** Monitoring locations, keyed by identifier. */
export function parseStations(csv) {
  const rows = parseCsv(csv);
  if (!rows.length) return new Map();
  const get = indexer(rows[0]);
  const out = new Map();
  for (const row of rows.slice(1)) {
    const id = get(row, 'MonitoringLocationIdentifier');
    const lat = Number(get(row, 'LatitudeMeasure'));
    const lng = Number(get(row, 'LongitudeMeasure'));
    // A station with no usable position cannot be matched to anything, and
    // defaulting it to 0,0 would put it in the Gulf of Guinea.
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.set(id, { id, name: get(row, 'MonitoringLocationName'), lat, lng });
  }
  return out;
}

/**
 * One row per READING, not per station. A spring measured six times between
 * 1961 and 2004 is six rows, and deciding what to publish from them is the
 * matcher's job rather than the mirror's.
 */
export function parseResults(csv) {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const get = indexer(rows[0]);
  const out = [];
  for (const row of rows.slice(1)) {
    const station = get(row, 'MonitoringLocationIdentifier');
    const raw = get(row, 'ResultMeasureValue');
    if (!station || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({
      station,
      measuredAt: get(row, 'ActivityStartDate'),
      value,
      unit: get(row, 'ResultMeasure/MeasureUnitCode'),
    });
  }
  return out;
}

/**
 * Celsius, or null when the source used a unit this does not recognise.
 *
 * Fahrenheit is converted rather than dropped: 7 of Nevada's 2,329 readings
 * are `deg F`, and a unit conversion of a measured value is arithmetic, not
 * the computed CLAIM rule 2 forbids. An unrecognised unit returns null rather
 * than assuming Celsius, because assuming is how 104 becomes a temperature no
 * spring has.
 */
export function celsiusOf(value, unit) {
  if (!Number.isFinite(value)) return null;
  const u = String(unit ?? '').trim().toLowerCase();
  if (u === 'deg c' || u === 'c') return value;
  if (u === 'deg f' || u === 'f') return Math.round(((value - 32) * 5) / 9 * 10) / 10;
  return null;
}

export const TSV_COLUMNS = ['station', 'name', 'lat', 'lng', 'measuredAt', 'celsius'];

/** Only `lat`, `lng` and `celsius` are measurements; see aist.mjs for why this
 * is stated as the text set rather than the numeric one. */
export const TSV_TEXT = new Set(['station', 'name', 'measuredAt']);
const TSV_NUMERIC = new Set(TSV_COLUMNS.filter((c) => !TSV_TEXT.has(c)));

/**
 * Join readings to their station and drop what cannot be used.
 *
 * A reading whose station is not in this tile's station file is discarded:
 * the two queries are taken seconds apart against a live service, and a
 * reading with no position is not a fact about anywhere.
 */
export function joinReadings(stations, results) {
  const out = [];
  for (const r of results) {
    const st = stations.get(r.station);
    if (!st) continue;
    const celsius = celsiusOf(r.value, r.unit);
    if (celsius === null) continue;
    out.push({
      station: r.station,
      name: st.name,
      lat: st.lat,
      lng: st.lng,
      measuredAt: r.measuredAt,
      celsius,
    });
  }
  return out;
}

export function toTsv(rows) {
  const body = rows.map((r) => TSV_COLUMNS.map((c) => {
    const v = r[c];
    // Tabs and newlines inside a station name would silently shift every
    // later column; station names are free text typed by field staff.
    return v === null || v === undefined ? '' : String(v).replace(/[\t\r\n]+/g, ' ');
  }).join('\t'));
  return `${TSV_COLUMNS.join('\t')}\n${body.join('\n')}\n`;
}

export function fromTsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return [];
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row = {};
    header.forEach((h, i) => {
      const v = cells[i] ?? '';
      row[h] = v === '' ? null : TSV_NUMERIC.has(h) ? Number(v) : v;
    });
    return row;
  });
}
