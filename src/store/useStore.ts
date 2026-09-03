import { create } from 'zustand';
import type { ClothingPolicy, HotSpring, SpringType } from '../lib/types';
import type { Units } from '../lib/format';
import { distanceKm } from '../lib/format';

export type PriceFilter = 'any' | 'free' | 'paid' | 'unknown';

export interface Filters {
  /** Celsius bounds. `includeUnknownTemp` decides what happens to null. */
  tempMin: number;
  tempMax: number;
  includeUnknownTemp: boolean;
  price: PriceFilter;
  clothing: ClothingPolicy[];
  types: SpringType[];
  country: string | null;
  openNowOnly: boolean;
  query: string;
}

export const TEMP_FLOOR = 0;
export const TEMP_CEIL = 100;

export const DEFAULT_FILTERS: Filters = {
  tempMin: TEMP_FLOOR,
  tempMax: TEMP_CEIL,
  includeUnknownTemp: true,
  price: 'any',
  clothing: [],
  types: [],
  country: null,
  openNowOnly: false,
  query: '',
};

interface State {
  springs: HotSpring[];
  /**
   * The filtered set. Held in the store rather than derived per-component so the
   * map and the results list are guaranteed to be showing the same springs, and
   * so the whole-dataset filter pass runs once per change instead of once per
   * subscriber.
   */
  visible: HotSpring[];
  loading: boolean;
  error: string | null;
  units: Units;
  filters: Filters;
  selectedId: string | null;
  userLocation: { lat: number; lng: number } | null;
  locating: boolean;
  showAbout: boolean;

  load: () => Promise<void>;
  setUnits: (u: Units) => void;
  toggleUnits: () => void;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  resetFilters: () => void;
  select: (id: string | null) => void;
  locateMe: () => void;
  setShowAbout: (v: boolean) => void;
}

const UNITS_KEY = 'whs.units';

function initialUnits(): Units {
  if (typeof localStorage === 'undefined') return 'c';
  const stored = localStorage.getItem(UNITS_KEY);
  if (stored === 'c' || stored === 'f') return stored;
  // Fahrenheit is the local convention in a short, well-known list of places.
  const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-GB';
  return /-(US|BS|BZ|KY|PW|FM|MH)$/i.test(locale) ? 'f' : 'c';
}

export const useStore = create<State>((set, get) => ({
  springs: [],
  visible: [],
  loading: true,
  error: null,
  units: initialUnits(),
  filters: DEFAULT_FILTERS,
  selectedId: null,
  userLocation: null,
  locating: false,
  showAbout: false,

  load: async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/hot-springs.geojson`);
      if (!res.ok) throw new Error(`dataset request failed (HTTP ${res.status})`);
      const geo = await res.json();
      const springs: HotSpring[] = geo.features.map((f: { properties: HotSpring }) => f.properties);
      set({ springs, visible: applyFilters(springs, get().filters), loading: false });
    } catch (err) {
      set({
        loading: false,
        error:
          err instanceof Error
            ? `${err.message}. Run \`npm run data:all\` to build the dataset.`
            : 'Could not load the dataset.',
      });
    }
  },

  setUnits: (u) => {
    localStorage.setItem(UNITS_KEY, u);
    set({ units: u });
  },
  toggleUnits: () => get().setUnits(get().units === 'c' ? 'f' : 'c'),

  setFilter: (key, value) =>
    set((s) => {
      const filters = { ...s.filters, [key]: value };
      return { filters, visible: applyFilters(s.springs, filters) };
    }),
  resetFilters: () =>
    set((s) => ({ filters: DEFAULT_FILTERS, visible: applyFilters(s.springs, DEFAULT_FILTERS) })),

  select: (id) => set({ selectedId: id }),
  setShowAbout: (v) => set({ showAbout: v }),

  locateMe: () => {
    if (!navigator.geolocation) return;
    set({ locating: true });
    navigator.geolocation.getCurrentPosition(
      (pos) => set({ userLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude }, locating: false }),
      () => set({ locating: false }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  },
}));

/**
 * Filtering rules that matter:
 * - A spring with an unknown temperature is not "0°C". It is excluded from the
 *   range test entirely and governed by `includeUnknownTemp`, so narrowing the
 *   slider never silently drops the springs we simply lack a reading for.
 * - "Open now" only ever includes springs we actually know are open. Unknown
 *   hours are excluded, because guessing is how someone drives four hours to a
 *   locked gate.
 */
export function applyFilters(springs: HotSpring[], f: Filters): HotSpring[] {
  const q = f.query.trim().toLowerCase();

  return springs.filter((s) => {
    const c = s.temperature.celsius;
    if (c === null) {
      if (!f.includeUnknownTemp) return false;
    } else if (c < f.tempMin || c > f.tempMax) {
      return false;
    }

    if (f.price === 'free' && s.access.price !== 'Free') return false;
    if (f.price === 'paid' && (!s.access.price || s.access.price === 'Free')) return false;
    if (f.price === 'unknown' && s.access.price) return false;

    if (f.clothing.length && !f.clothing.includes(s.clothing.policy)) return false;
    if (f.types.length && !f.types.includes(s.type)) return false;
    if (f.country && s.location.country !== f.country) return false;
    if (f.openNowOnly && s.hours.status !== 'open') return false;

    if (q) {
      const haystack = [
        s.name,
        s.location.countryName,
        s.location.region,
        s.location.nearestTown,
        ...s.tags,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });
}

export function sortByDistance(springs: HotSpring[], from: { lat: number; lng: number }): HotSpring[] {
  return [...springs].sort(
    (a, b) => distanceKm(from, a.location) - distanceKm(from, b.location),
  );
}
