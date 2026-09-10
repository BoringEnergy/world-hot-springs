/**
 * AIST / GSJ's onsen gazetteer, read into rows this pipeline can use.
 *
 * The source is a 7,203-row CSV of Japanese wellhead analyses. Three things
 * about it need care, and each one is a defect if guessed at:
 *
 *   1. It is Shift_JIS, as published. Decoding it as UTF-8 yields mojibake
 *      that still parses as a CSV and still has 82 columns -- so the failure
 *      does not look like a bad decode, it looks like every single name
 *      disagreeing. The fetcher decodes explicitly and a test pins it.
 *   2. `位置` holds WKT geometry, and WKT is full of commas. A naive
 *      split(',') shifts every column after it, so a real quoted-field parser
 *      is not optional here.
 *   3. `N/A` is the null marker, and numbers carry trailing spaces.
 */

/** Columns, by index, in the published file. */
const COL = {
  ser: 0,
  onsenName: 3,
  sourceName: 4,
  prefecture: 5,
  city: 6,
  wkt: 7,
  sampledYear: 8,
  celsius: 11,
  ph: 14,
  tds: 17,
  sodium: 20,
  calcium: 23,
  magnesium: 24,
  iron: 25,
  chloride: 31,
  sulfate: 33,
  bicarbonate: 36,
  silica: 51,
  unit: 70,
};

export const AIST_PROVIDER = 'aist';

export const AIST_SOURCE =
  'AIST/GSJ, Geochemical Map of Hot Spring Waters (GRES-DB ONSEN 2020), gbank.gsj.jp/gres-db';

export const AIST_URL = 'https://gbank.gsj.jp/gres-db/download/onsen/GSJ_DB_GRES-DB_ONSEN_2020.zip';

/**
 * What a reader gets sent to.
 *
 * `sources` is rendered as <a href={src}> on the card, so it must be a page a
 * person can read -- pointing them at a 817 KB zip would be a download, not a
 * citation. Same split as NCEI: the DOI-style landing page here, the full
 * citation string on temperature.source, which renders as text.
 */
export const AIST_PAGE = 'https://gbank.gsj.jp/gres-db/';

/**
 * RFC4180 enough for this file: quoted fields, doubled quotes inside them,
 * commas and newlines only where the quotes permit. Written rather than
 * imported because the one thing it must get right -- a comma inside
 * `POLYGON((...))` -- is the thing a smaller shortcut gets wrong.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s === '' || s === 'N/A' ? null : s;
};

const num = (v) => {
  const s = clean(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const RING = /POLYGON\s*\(\((.+?)\)\)/i;

/**
 * Area-weighted centroid of a WKT polygon ring.
 *
 * Used ONLY as a distance key. Every cell in this file is 187-191 m across --
 * a publisher's privacy choice, not GPS scatter -- so the centroid is never
 * written to location.lat/lng and never mints a pin. See the spec: enrichment
 * must not un-fuzz anything a reader can click.
 */
export function centroidOf(wkt) {
  const m = String(wkt ?? '').match(RING);
  if (!m) return null;
  const pts = m[1].split(',').map((p) => p.trim().split(/\s+/).map(Number))
    .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 3) return null;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  // A degenerate ring has zero area; fall back to the vertex mean rather than
  // dividing by zero and emitting NaN coordinates into a distance test.
  if (a === 0) {
    const n = pts.length - 1;
    return { lng: pts.slice(0, n).reduce((s, p) => s + p[0], 0) / n,
             lat: pts.slice(0, n).reduce((s, p) => s + p[1], 0) / n };
  }
  a *= 0.5;
  return { lng: cx / (6 * a), lat: cy / (6 * a) };
}

/**
 * The year `採水年月日` states, as a string.
 *
 * The spec proposing this import called this column "a decimal year (1978.5)".
 * It is not: it is a DOTTED DATE, and 1978.5 means May 1978. Measured across
 * the file, 1,756 rows are YYYY.MM.DD and 1,346 are YYYY.M.DD, against only
 * 461 that are YYYY.M and 191 bare YYYY. Reading it as a number therefore
 * turned "1977.12.25" into NaN and silently discarded 83% of the dates this
 * file actually publishes -- and it discarded them quietly, as an absent
 * measuredAt, which is indistinguishable from a row that never stated one.
 *
 * So take the leading four-digit year and do not invent a month. 2,692 of
 * 7,203 rows genuinely state no date, the median analysis is from 1975, and
 * measuredAt is the honesty mechanism for that rather than polish.
 *
 * A few rows state a RANGE ("1975～1980"). Take the first year: it is the one
 * the file states first, and understating freshness is the safe direction for
 * a field whose whole job is to stop an old analysis reading as a new one.
 */
export function sampledYear(v) {
  const s = clean(v);
  if (s === null) return null;
  const m = s.match(/\d{4}/);
  if (!m) return null;
  const year = Number(m[0]);
  return year >= 1800 && year <= 2100 ? String(year) : null;
}

/**
 * The unit the analysis panel is printed in.
 *
 * 5,129 rows are mg/kg and 1,766 are mg/l; both are carried as published,
 * never converted, because mg/kg -> mg/L needs a density 74% of those rows do
 * not state. One row holds "0.0002" in this column, which is garbage rather
 * than a unit, so anything not recognised becomes null -- the honest reading
 * of "the source published figures without saying which".
 */
export function unitOf(v) {
  const s = clean(v);
  if (s === null) return null;
  const l = s.toLowerCase();
  if (l === 'mg/kg') return 'mg/kg';
  if (l === 'mg/l' || l === 'mg/ℓ') return 'mg/l';
  return null;
}

/** One published analysis, as this pipeline wants it. */
export function toRow(cols) {
  const centroid = centroidOf(cols[COL.wkt]);
  if (!centroid) return null;
  return {
    ser: clean(cols[COL.ser]),
    onsenName: clean(cols[COL.onsenName]),
    sourceName: clean(cols[COL.sourceName]),
    prefecture: clean(cols[COL.prefecture]),
    lat: centroid.lat,
    lng: centroid.lng,
    measuredAt: sampledYear(cols[COL.sampledYear]),
    celsius: num(cols[COL.celsius]),
    unit: unitOf(cols[COL.unit]),
    ph: num(cols[COL.ph]),
    tds: num(cols[COL.tds]),
    sodium: num(cols[COL.sodium]),
    calcium: num(cols[COL.calcium]),
    magnesium: num(cols[COL.magnesium]),
    iron: num(cols[COL.iron]),
    chloride: num(cols[COL.chloride]),
    sulfate: num(cols[COL.sulfate]),
    bicarbonate: num(cols[COL.bicarbonate]),
    silica: num(cols[COL.silica]),
  };
}

/**
 * Parse the published CSV. Rows without usable geometry are rejected rather
 * than defaulted: a row with no position cannot be matched to anything, and
 * giving it 0,0 would put it in the Gulf of Guinea.
 */
export function parseAist(text) {
  const rows = parseCsv(text);
  const out = [];
  const rejected = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (cols.length < 71) {
      if (cols.some((c) => c !== '')) rejected.push({ line: i + 1, reason: 'short row' });
      continue;
    }
    const row = toRow(cols);
    if (!row) { rejected.push({ line: i + 1, reason: 'unparseable geometry' }); continue; }
    out.push(row);
  }
  return { rows: out, rejected };
}

/** The columns this pipeline keeps, in the order the pruned TSV writes them. */
export const TSV_COLUMNS = [
  'ser', 'onsenName', 'sourceName', 'prefecture', 'lat', 'lng', 'measuredAt',
  'celsius', 'unit', 'ph', 'tds', 'sodium', 'calcium', 'magnesium', 'iron',
  'chloride', 'sulfate', 'bicarbonate', 'silica',
];

const TSV_NUMERIC = new Set(['lat', 'lng', 'celsius', 'ph', 'tds', 'sodium', 'calcium',
  'magnesium', 'iron', 'chloride', 'sulfate', 'bicarbonate', 'silica']);

export function toTsv(rows) {
  const body = rows.map((r) => TSV_COLUMNS.map((c) => r[c] ?? '').join('\t'));
  return `${TSV_COLUMNS.join('\t')}\n${body.join('\n')}\n`;
}

/**
 * Read the mirror back.
 *
 * Splits on /\r?\n/ rather than '\n' because the mirror is a COMMITTED file
 * and git hands it back with CRLF on Windows. Splitting on '\n' alone left a
 * trailing carriage return welded to the last column name, so the parsed row
 * carried `silica\r` and every silica reading was silently absent -- present
 * in the file, never read, withheld with no error. The dataset built before
 * the first checkout still had them, so this was a reproducibility break
 * rather than a visible one: the same command on the same input would produce
 * different output depending on whose machine ran it.
 */
export function fromTsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
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
