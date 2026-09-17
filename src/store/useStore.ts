import { create } from 'zustand';
import type { ClothingPolicy, DatasetMeta, HotSpring, SpringType } from '../lib/types';
import type { Units } from '../lib/format';
import { distanceKm } from '../lib/format.ts';
import { navigate, parse, type PageName, type Route } from '../lib/router.ts';
import { applyDefaultMeta, applyPageMeta, applySpringMeta } from '../lib/seo.ts';
import { UNITS_KEY } from '../lib/storage.ts';

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
  /**
   * The dataset's own licence and source list, kept rather than discarded:
   * it is the only copy of that list the browser can see, and the About panel
   * is required to render from it instead of from prose.
   */
  meta: DatasetMeta | null;
  loading: boolean;
  error: string | null;
  units: Units;
  filters: Filters;
  selectedId: string | null;
  userLocation: { lat: number; lng: number } | null;
  locating: boolean;
  showAbout: boolean;
  /**
   * The standing pages -- terms, privacy, safety, sources. Separate from
   * `showAbout` rather than folded into it: About is a panel the header has
   * always owned, and collapsing the two would have rewritten every call site
   * for no gain. Both push a URL.
   */
  page: Exclude<PageName, 'about'> | null;

  load: () => Promise<void>;
  setUnits: (u: Units) => void;
  toggleUnits: () => void;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  resetFilters: () => void;
  select: (id: string | null) => void;
  locateMe: () => void;
  setShowAbout: (v: boolean) => void;
  setPage: (p: Exclude<PageName, 'about'> | null) => void;
  /** Apply a route to state without writing it back to the address bar. */
  applyRoute: (route: Route) => void;
}

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
  meta: null,
  loading: true,
  error: null,
  units: initialUnits(),
  filters: DEFAULT_FILTERS,
  selectedId: null,
  userLocation: null,
  locating: false,
  showAbout: false,
  page: null,

  load: async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/hot-springs.geojson`);
      if (!res.ok) throw new Error(`dataset request failed (HTTP ${res.status})`);
      const geo = await res.json();
      const springs: HotSpring[] = geo.features.map((f: { properties: HotSpring }) => f.properties);
      set({
        springs,
        meta: (geo.metadata as DatasetMeta | undefined) ?? null,
        visible: applyFilters(springs, get().filters),
        loading: false,
      });

      /*
       * The address bar is authoritative on arrival, and only now can it be
       * honoured: /s/whs_... has to resolve against records that did not exist
       * until this moment. Doing it here rather than in a component keeps the
       * one race that matters -- deep link vs dataset -- in a single place.
       *
       * An id that parses but matches nothing is normalised away with
       * replaceState. A dead permalink that keeps its URL is a permalink that
       * gets crawled, cached and cited, and the canonical tag would point a
       * search engine at a card that renders nothing.
       */
      const route = parse();
      if (route.kind === 'spring' && !springs.some((s) => s.id === route.id)) {
        navigate({ kind: 'map' }, { replace: true });
        get().applyRoute({ kind: 'map' });
      } else {
        get().applyRoute(route);
      }
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

  /*
   * Selection and navigation are the same act now. `select` is called from the
   * map, the results list and the card's own close button, so putting the
   * history write here means every one of those paths produces a shareable URL
   * and a working Back button without any of them knowing a router exists.
   */
  select: (id) => {
    set({ selectedId: id, showAbout: false, page: null });
    if (id) {
      navigate({ kind: 'spring', id });
      const spring = get().springs.find((s) => s.id === id);
      if (spring) applySpringMeta(spring);
    } else {
      navigate({ kind: 'map' });
      applyDefaultMeta(get().meta);
    }
  },

  setShowAbout: (v) => {
    set({ showAbout: v, ...(v ? { page: null } : {}) });
    if (v) {
      navigate({ kind: 'page', page: 'about' });
      applyPageMeta('about');
    } else if (get().selectedId === null) {
      navigate({ kind: 'map' });
      applyDefaultMeta(get().meta);
    }
  },

  setPage: (p) => {
    set({ page: p, ...(p ? { showAbout: false } : {}) });
    if (p) {
      navigate({ kind: 'page', page: p });
      applyPageMeta(p);
    } else if (get().selectedId === null) {
      navigate({ kind: 'map' });
      applyDefaultMeta(get().meta);
    }
  },

  /*
   * The read direction: URL -> state. Used on boot and on popstate, and it
   * must never write history back, or Back would fight itself.
   */
  applyRoute: (route) => {
    if (route.kind === 'spring') {
      const spring = get().springs.find((s) => s.id === route.id) ?? null;
      set({ selectedId: spring ? route.id : null, showAbout: false, page: null });
      if (spring) applySpringMeta(spring);
      else applyDefaultMeta(get().meta);
      return;
    }
    if (route.kind === 'page') {
      set({
        selectedId: null,
        showAbout: route.page === 'about',
        page: route.page === 'about' ? null : route.page,
      });
      applyPageMeta(route.page);
      return;
    }
    set({ selectedId: null, showAbout: false, page: null });
    applyDefaultMeta(get().meta);
  },

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
 * - The ceiling is a floor on the last band, not a lid on the dataset. The rail
 *   already renders it as "212°F+" and means it; the predicate has to agree.
 *   Three springs boil -- 110C, 102C, 101C -- and a hard `c > tempMax` hid all
 *   three from every view the UI can reach, including a search for one by name,
 *   which answered "0 springs" for a spring this atlas holds. They are the
 *   hottest water in here, so they are the records the scalding warning exists
 *   to carry.
 */
export function applyFilters(springs: HotSpring[], f: Filters): HotSpring[] {
  const q = f.query.trim().toLowerCase();
  const capped = f.tempMax < TEMP_CEIL;

  return springs.filter((s) => {
    const c = s.temperature.celsius;
    if (c === null) {
      if (!f.includeUnknownTemp) return false;
    } else if (c < f.tempMin || (capped && c > f.tempMax)) {
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
