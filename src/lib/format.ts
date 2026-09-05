import type { AccessStatus, ClothingPolicy, HotSpring, HoursStatus, MineralType, SpringType } from './types';

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
