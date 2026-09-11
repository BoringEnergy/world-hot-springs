/**
 * NBMG spring chemistry: Nevada and Colorado.
 *
 * The decisions this implements, and the measurements behind them, are in
 * docs/superpowers/specs/2026-09-11-nbmg-chemistry-spec.md.
 *
 * Temperature is deliberately NOT read from this source. It yields twelve
 * springs and is closed, not deferred -- see the findings document. The
 * service carries FluidTemperature_C on almost every row, so the omission is
 * a choice and this comment is the reason it stays one.
 */

export const NBMG_PROVIDER = 'nbmg';

export const NBMG_SOURCE =
  'Nevada Bureau of Mines and Geology, AASG state geothermal data (aqSpringChemistry)';

export const NBMG_PAGE = 'https://web2.nbmg.unr.edu/ArcGIS/rest/services/';

/** The four layers carrying panel constituents, per state. */
export const SERVICES = [
  ['NV', 'NV_Data/NVaqSpringChemistry'],
  ['CO', 'CO_Data/COaqSpringChemistry'],
];
export const LAYERS = /^(CommonAnalytes|MajorDissolvedConstituents|MinorDissolvedConstituents|WaterQuality)$/;

/**
 * Column -> field, audited against row counts rather than guessed.
 *
 * Two of ten were wrong on the first attempt and both would have published
 * silently, so the spec states this as a table and nbmg.test.mjs checks it
 * against the real mirror.
 *
 *   Alkalinity_mgL is NOT bicarbonate. It is reported as CaCO3 equivalent,
 *   a different quantity. Bicarbonate_mgL is the real column and carries
 *   1,045 values against 137.
 *
 *   FeTot_mgL, not Fe_mgL: total iron rather than dissolved, which is the
 *   same choice the AIST import makes reading TFe. One definition of "iron"
 *   across two upstreams is worth more than the extra rows.
 *
 * `tds` is absent on purpose. TotalDissolvedSolids_mgL exists in two layers
 * and is null in all 3,683 rows -- published, never populated.
 */
export const COLUMNS = {
  calcium: ['Ca_mgL'],
  magnesium: ['Mg_mgL'],
  sodium: ['Na_mgL'],
  potassium: ['K_mgL'],
  silica: ['SiO2_mgL'],
  chloride: ['Cl_mgL'],
  sulfate: ['SO4_mgL'],
  bicarbonate: ['Bicarbonate_mgL'],
  iron: ['FeTot_mgL'],
  // Field before lab: carbonate chemistry shifts on the way to a lab, so a
  // pH measured at the spring beats one measured after the sample travelled.
  ph: ['ph_Field', 'ph_Lab'],
};

export const PANEL = Object.keys(COLUMNS);

/**
 * Sentinels this service uses for "no value". Read as numbers they would
 * publish a figure no water has.
 */
const NULLS = new Set([-99999, -9999, -999]);

export function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && !NULLS.has(v) ? v : null;
}

/**
 * Epoch milliseconds to a plain year, or null. The service has no other date.
 *
 * Negative values are ordinary: 2,754 Nevada rows predate 1970 and express it
 * as negative milliseconds, which is exactly right and must not be mistaken
 * for a sentinel.
 *
 * The two ZERO-DATES are rejected. 927 rows land on 1900-01-01 to the
 * millisecond and 8 on 1970-01-01, which are the two classic placeholders for
 * "no date entered"; every other 1900s and 1970s value is spread across real
 * days. Published as `minerals.measuredAt` they would put a fabricated
 * analysis date on a card, which is worse than the empty field the source
 * actually means.
 */
const ZERO_DATES = new Set([
  Date.UTC(1900, 0, 1),
  Date.UTC(1970, 0, 1),
]);

export function yearOf(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || NULLS.has(v)) return null;
  if (ZERO_DATES.has(v)) return null;
  const d = new Date(v);
  const y = d.getUTCFullYear();
  return y >= 1900 && y <= 2100 ? String(y) : null;
}

/**
 * One ArcGIS feature to a mirror row, or null when it carries nothing.
 *
 * Rows are kept per ANALYSIS rather than merged per site, because AnalysisURI
 * is not shared between layers -- 0 of 1,900 match -- so there is no way to
 * tell which values came from the same sample. SamplingFeatureURI IS shared,
 * so the site is the join and the matcher groups on it.
 */
export function toRow(attrs, state) {
  const lat = num(attrs.LatDegree);
  const lng = num(attrs.LongDegree);
  const site = attrs.SamplingFeatureURI;
  if (!site || lat === null || lng === null) return null;
  const row = {
    site,
    name: attrs.SamplingFeatureName ?? null,
    state,
    lat,
    lng,
    measuredAt: yearOf(attrs.SpecimenCollectionDate),
  };
  let any = false;
  for (const field of PANEL) {
    let v = null;
    for (const col of COLUMNS[field]) {
      v = num(attrs[col]);
      if (v !== null) break;
    }
    row[field] = v;
    if (v !== null) any = true;
  }
  return any ? row : null;
}

export const TSV_COLUMNS = ['site', 'name', 'state', 'lat', 'lng', 'measuredAt', ...PANEL];

/** Stated as the TEXT set; see aist.mjs for the drift this shape prevents. */
export const TSV_TEXT = new Set(['site', 'name', 'state', 'measuredAt']);
const TSV_NUMERIC = new Set(TSV_COLUMNS.filter((c) => !TSV_TEXT.has(c)));

export function toTsv(rows) {
  const body = rows.map((r) => TSV_COLUMNS.map((c) => {
    const v = r[c];
    // Site names are free text. One stray tab would move every later column.
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
