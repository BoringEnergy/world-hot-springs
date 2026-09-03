import type { HotSpring } from './types';
import { tempBand, type TempBandId } from './types';

/**
 * Deterministic procedural-scene math for the soak view.
 *
 * Every function here is pure and seeded: the same spring renders the same
 * scene on every visit, on every device. Randomness would make the atlas
 * feel like it is inventing a different place each time — the same reason
 * the dataset never invents a temperature.
 */

/** FNV-1a hash: a short string id becomes a stable uint32 seed. */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: small, fast, and good enough for ridgelines and starfields. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Solar elevation in degrees for a lat/lng at a moment in time.
 * Deliberately approximate (declination + hour angle only): the scene needs
 * "golden hour" versus "high sun", not an almanac.
 */
export function solarElevation(lat: number, lng: number, date: Date): number {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - yearStart) / 86_400_000);
  const decl = (-23.44 * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365) * Math.PI) / 180;
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const hourAngle = ((15 * (utcHours + lng / 15 - 12)) * Math.PI) / 180;
  const la = (lat * Math.PI) / 180;
  const sinE = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(hourAngle);
  return (Math.asin(Math.max(-1, Math.min(1, sinE))) * 180) / Math.PI;
}

/** Fraction of the UTC day elapsed at this longitude: positions the sun/moon. */
export function dayProgress(lng: number, date: Date): number {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  return (((utcHours + lng / 15) % 24) + 24) % 24 / 24;
}

export function daylightWord(elevation: number): string {
  if (elevation > 25) return 'high sun';
  if (elevation > 0) return 'low sun';
  if (elevation > -6) return 'golden hour';
  if (elevation > -12) return 'blue hour';
  return 'night';
}

export interface BandPalette {
  /** Water colour for the pool band. */
  water: string;
  /** Deep water at the pool's foot. */
  waterDeep: string;
  /** Sun/moon glow tint. */
  glow: string;
}

export function bandPalette(band: TempBandId): BandPalette {
  switch (band) {
    case 'cool':
      return { water: '#5b8fc9', waterDeep: '#1d2f45', glow: '#cfe3f7' };
    case 'warm':
      return { water: '#4bab8f', waterDeep: '#17352c', glow: '#d3efe2' };
    case 'hot':
      return { water: '#e0a33a', waterDeep: '#3d2a10', glow: '#f7e3bd' };
    case 'very-hot':
      return { water: '#d9663a', waterDeep: '#3d1c0e', glow: '#f6cfae' };
    case 'scalding':
      return { water: '#b8332e', waterDeep: '#3a100e', glow: '#f2b8b0' };
    case 'unknown':
    default:
      // Still air, still water: grey-green calm, never a guessed steamy glow.
      return { water: '#8b8478', waterDeep: '#23211d', glow: '#d8d2c6' };
  }
}

/** Steam density follows the reading. Null is not zero degrees — it is no
 *  rendering at all, which the component captions honestly. */
export function steamCount(spring: HotSpring): number {
  const c = spring.temperature.celsius;
  if (c === null) return 0;
  if (c < 25) return 6;
  if (c < 38) return 14;
  if (c < 50) return 22;
  return 30;
}

export function sceneBand(spring: HotSpring): TempBandId {
  return tempBand(spring.temperature.celsius);
}

export interface SpringWeather {
  tempC: number;
  code: number;
}

const WEATHER_LABELS: Array<[max: number, label: string]> = [
  [0, 'clear sky'],
  [3, 'partly cloudy'],
  [48, 'fog'],
  [67, 'drizzle'],
  [77, 'snow'],
  [82, 'rain showers'],
  [99, 'thunderstorms'],
];

export function weatherLabel(code: number): string {
  for (const [max, label] of WEATHER_LABELS) {
    if (code <= max) return label;
  }
  return 'changing skies';
}

/**
 * Live air conditions from Open-Meteo: keyless, CORS-open, CC-BY 4.0
 * (credited next to the reading). Never throws — failure means null, and
 * the scene renders record-only. A blocked network must degrade to the
 * dataset, never to an error state.
 */
export async function fetchSpringWeather(
  lat: number,
  lng: number,
  signal: AbortSignal,
): Promise<SpringWeather | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}` +
      `&longitude=${lng.toFixed(4)}&current=temperature_2m,weather_code`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      current?: { temperature_2m?: unknown; weather_code?: unknown };
    };
    const tempC = json.current?.temperature_2m;
    const code = json.current?.weather_code;
    if (typeof tempC !== 'number' || typeof code !== 'number') return null;
    return { tempC, code };
  } catch {
    return null;
  }
}
