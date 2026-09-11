import type { AccessStatus, ClothingPolicy, HotSpring, HoursStatus, MineralType, MineralUnit, SpringType } from './types';

export type Units = 'c' | 'f';

/**
 * The single place "we don't know" becomes text. Everything renders through
 * here so an unknown value can never quietly become an empty string.
 */
export const UNKNOWN = 'Unknown';

export function formatTemp(spring: HotSpring, units: Units): string {
  const { celsius, fahrenheit } = spring.temperature;
  if (celsius === null) return UNKNOWN;
  return units === 'c' ? `${celsius}°C` : `${fahrenheit ?? Math.round(((celsius * 9) / 5 + 32) * 10) / 10}°F`;
}

export function formatTempValue(celsius: number | null, units: Units): string {
  if (celsius === null) return UNKNOWN;
  return units === 'c'
    ? `${Math.round(celsius)}°C`
    : `${Math.round((celsius * 9) / 5 + 32)}°F`;
}

/**
 * How a mineral unit is written on a card. The stored value is lowercase
 * because that is how the source prints it; the display capitalises the litre
 * the way every analysis does.
 *
 * Null when the source published figures without naming a unit. The card then
 * shows the bare number and says so in the footnote, rather than assuming
 * mg/L -- the same posture `measuredAt: null` already takes about an undated
 * analysis.
 */
export function formatMineralUnit(unit: MineralUnit | null): string | null {
  if (unit === 'mg/l') return 'mg/L';
  if (unit === 'mg/kg') return 'mg/kg';
  return null;
}

export function formatName(spring: HotSpring): string {
  return spring.name ?? 'Unnamed spring';
}

export function formatPrice(spring: HotSpring): string {
  return spring.access.price ?? UNKNOWN;
}

const CLOTHING_LABEL: Record<ClothingPolicy, string> = {
  optional: 'Clothing optional',
  required: 'Nudity required',
  'textile-only': 'Swimwear required',
  mixed: 'Mixed / varies',
  unknown: UNKNOWN,
};

export function formatClothing(policy: ClothingPolicy): string {
  return CLOTHING_LABEL[policy];
}

const HOURS_LABEL: Record<HoursStatus, string> = {
  open: 'Open',
  seasonal: 'Seasonal',
  closed: 'Closed',
  unknown: UNKNOWN,
};

export function formatHoursStatus(status: HoursStatus): string {
  return HOURS_LABEL[status];
}

const TYPE_LABEL: Record<SpringType, string> = {
  natural: 'Natural',
  developed: 'Developed',
  resort: 'Resort',
  wild: 'Wild',
  unknown: UNKNOWN,
};

export function formatType(type: SpringType): string {
  return TYPE_LABEL[type];
}

/**
 * Whole sentences, not labels. This text follows "Bathing is not permitted
 * here." in the prohibition banner, where a bare word like "View-only" would
 * read as a category rather than a rule.
 */
const ACCESS_STATUS_LABEL: Record<AccessStatus, string> = {
  public: 'Open to the public.',
  permit: 'A permit is required to visit.',
  'view-only': 'The site may be viewed but not entered.',
  closed: 'The site is closed to visitors.',
  unknown: 'The managing agency restricts it.',
};

export function formatAccessStatus(status: AccessStatus): string {
  return ACCESS_STATUS_LABEL[status];
}

export function formatElevation(m: number | null, units: Units): string {
  if (m === null) return UNKNOWN;
  return units === 'c' ? `${m} m` : `${Math.round(m * 3.28084)} ft`;
}

export function formatCoords(lat: number, lng: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${ns}, ${Math.abs(lng).toFixed(4)}°${ew}`;
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(km: number, units: Units): string {
  if (units === 'f') {
    const mi = km * 0.621371;
    return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
  }
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/**
 * Named constituents in the order a published analysis usually lists them:
 * anions, then cations, then silica and iron. Not alphabetical — a reader
 * comparing two springs wants the same rows in the same places.
 */
export const MINERAL_CONSTITUENTS = [
  ['sulfate', 'Sulfate'],
  ['bicarbonate', 'Bicarbonate'],
  ['chloride', 'Chloride'],
  ['calcium', 'Calcium'],
  ['magnesium', 'Magnesium'],
  ['sodium', 'Sodium'],
  ['potassium', 'Potassium'],
  ['silica', 'Silica'],
  ['iron', 'Iron'],
] as const;

/** Human label for a Hot Spring Law classification. */
export function formatMineralType(t: MineralType): string {
  const labels: Record<MineralType, string> = {
    simple: 'Simple',
    chloride: 'Chloride',
    bicarbonate: 'Bicarbonate',
    sulfate: 'Sulfate',
    'carbon-dioxide': 'Carbon dioxide',
    iron: 'Iron',
    acidic: 'Acidic',
    iodine: 'Iodine',
    sulfur: 'Sulfur',
    radioactive: 'Radioactive',
    aluminium: 'Aluminium',
  };
  return labels[t] ?? t;
}

/** Does this spring have any published chemistry at all? */
export function hasMinerals(m: HotSpring['minerals']): boolean {
  return (
    m.ph !== null ||
    m.tds !== null ||
    m.types.length > 0 ||
    m.notes !== null ||
    MINERAL_CONSTITUENTS.some(([k]) => m[k] !== null)
  );
}

/**
 * The card's display model.
 *
 * Everything below answers "what does this card SAY about a spring", as a
 * function of a HotSpring rather than a thicket of JSX. That distinction is
 * the point: the two worst display bugs this project has shipped were both
 * model bugs wearing a rendering costume.
 *
 *   The blank page      an optional key present-but-undefined is not the same
 *                       as an absent key, and the difference was invisible in
 *                       markup.
 *   The bare figures    Radium rendered `Sulfate 302` under a hardcoded mg/L
 *                       while its source said mg/l and the schema had nowhere
 *                       to put it.
 *
 * Neither needed a browser to catch. They needed the decision to be a value
 * something could assert on. These functions import no React and touch no DOM,
 * so `node --test` reaches them with the runner this repository already has.
 */

/** One rendered line of the mineral panel. */
export interface MineralRow {
  key: string;
  label: string;
  /** Exactly the text the card shows, unit included when the source named one. */
  value: string;
}

/**
 * The mineral panel, as lines.
 *
 * pH is first and carries no unit -- it is unitless, and appending the panel's
 * mg/kg to it would be a units error on a field people read for skin safety.
 * Every other figure takes the unit `minerals.unit` names, or none at all when
 * the source published figures without saying.
 */
export function mineralRows(m: HotSpring['minerals']): MineralRow[] {
  const unit = formatMineralUnit(m.unit);
  const suffix = unit ? ` ${unit}` : '';
  const rows: MineralRow[] = [];
  if (m.ph !== null) rows.push({ key: 'ph', label: 'pH', value: String(m.ph) });
  if (m.tds !== null) rows.push({ key: 'tds', label: 'Dissolved solids', value: `${m.tds}${suffix}` });
  for (const [key, label] of MINERAL_CONSTITUENTS) {
    const v = m[key];
    if (v !== null) rows.push({ key, label, value: `${v}${suffix}` });
  }
  return rows;
}

/**
 * The sentence under the mineral panel.
 *
 * Three facts, each conditional, in a fixed order: when it was analysed, what
 * unit it is in, and that this atlas did not measure any of it. The last is
 * unconditional and must stay that way -- a panel rendered bare reads as a
 * measurement somebody took for you.
 */
export function mineralsFootnote(m: HotSpring['minerals']): string {
  const parts = [
    m.measuredAt
      ? `Analysed ${m.measuredAt} according to the source below.`
      : 'The source publishes these figures without stating when the water was analysed.',
  ];
  if (formatMineralUnit(m.unit) === null && mineralRows(m).some((r) => r.key !== 'ph')) {
    parts.push('The source does not state what unit these figures are in.');
  }
  parts.push('Reported from public sources. This atlas does not test water and has not verified these figures on site.');
  return parts.join(' ');
}

/** Everything the temperature block shows, or null where it shows nothing. */
export interface TemperatureDisplay {
  primary: string;
  /** The same reading in the other unit, so a reader can check the conversion. */
  secondary: string | null;
  /** "described as hot", when there is no number at all. */
  qualitative: string | null;
  measuredAt: string | null;
  /** "at source" / "bathing water". Null for `unknown`, the majority case. */
  kind: string | null;
  source: string | null;
}

export function temperatureDisplay(spring: HotSpring, units: Units): TemperatureDisplay {
  const { celsius, fahrenheit, qualitative, measuredAt, kind, source } = spring.temperature;
  const known = celsius !== null;
  return {
    primary: formatTemp(spring, units),
    secondary: known ? (units === 'c' ? `${fahrenheit}°F` : `${celsius}°C`) : null,
    // Only where there is no number. A qualitative word beside a figure is
    // noise; on its own it is the only thing the source said.
    qualitative: !known && qualitative ? `described as ${qualitative}` : null,
    measuredAt: measuredAt ? `Measured ${measuredAt} according to the source below.` : null,
    // `unknown` renders nothing rather than the word "unknown": it is the
    // majority case, and a label on every record would be noise.
    kind: known && kind !== 'unknown' ? (kind === 'source' ? 'at source' : 'bathing water') : null,
    source: source ?? null,
  };
}

/**
 * Whether the card must tell someone not to get in.
 *
 * Keyed on `access.bathingAllowed === false` and nothing else, because the
 * same field decides whether the soak illustration is drawn at all. An atlas
 * that draws inviting water on a pool you must not enter argues against its
 * own warning, so the two must never disagree about which springs those are.
 */
export function prohibitionNotice(spring: HotSpring): { prohibited: boolean; text: string } {
  const prohibited = spring.access.bathingAllowed === false;
  return {
    prohibited,
    text: prohibited ? `Bathing is not permitted here. ${formatAccessStatus(spring.access.status)}` : '',
  };
}

/**
 * How precisely a pin is placed, as the card says it.
 *
 * Null renders nothing rather than "Unknown": the coordinate is shown either
 * way, and a label on every record would be noise on the majority. What this
 * exists to stop is a 190 m cell centroid reading like somebody standing at
 * the spring.
 */
export function formatAccuracy(metres: number | null, units: Units): string | null {
  if (metres === null || !Number.isFinite(metres)) return null;
  if (units === 'c') {
    return metres >= 1000
      ? `located to about ${Math.round(metres / 100) / 10} km`
      : `located to about ${Math.round(metres)} m`;
  }
  const feet = metres * 3.28084;
  return feet >= 5280
    ? `located to about ${Math.round((feet / 5280) * 10) / 10} miles`
    : `located to about ${Math.round(feet / 10) * 10} ft`;
}
