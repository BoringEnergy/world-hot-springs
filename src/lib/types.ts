/**
 * The canonical HotSpring record.
 *
 * Rule that governs every field: unknown values are stored explicitly as `null`
 * (or the literal `"unknown"` for enums) and rendered as "Unknown" in the UI.
 * We never invent a value and never leave a field blank to imply one.
 *
 * Deviation from SPEC.md, deliberate: `name` is `string | null` rather than
 * `string`. A large share of real, publicly-mapped springs have no name in any
 * source. Synthesising one ("Hot spring near Reykjadalur") would be inventing
 * data, which the rule above forbids. The UI renders null as "Unnamed spring".
 */
/**
 * Japan's Hot Spring Law (温泉法) classifies springs by 泉質 into these
 * categories. Adopted rather than invented: it is the only widely published
 * standard, Japanese operators are legally required to post their
 * classification under it, and 778 springs in this dataset are already tagged
 * onsen. A vocabulary of our own would have had no sources behind it.
 */
export type MineralType =
  | 'simple'
  | 'chloride'
  | 'bicarbonate'
  | 'sulfate'
  | 'carbon-dioxide'
  | 'iron'
  | 'acidic'
  | 'iodine'
  | 'sulfur'
  | 'radioactive'
  | 'aluminium';

export interface HotSpring {
  /**
   * Durable id, stable across rebuilds and across OpenStreetMap redrawing the
   * spring under a new element id. Claims in `data/overlay/` are keyed by it,
   * which is what lets a curated correction survive a re-ingest.
   */
  id: string;
  /** Every OSM element this record was derived from, e.g. ["node/4702109263"]. */
  osmRefs: string[];
  name: string | null;
  location: {
    lat: number;
    lng: number;
    /** Metres above sea level. */
    elevation: number | null;
    /** ISO 3166-1 alpha-2, or "XX" when the point resolves to no country. */
    country: string;
    countryName: string;
    region: string | null;
    nearestTown: string | null;
  };
  temperature: {
    celsius: number | null;
    fahrenheit: number | null;
    /** Where the measurement came from, e.g. "OpenStreetMap tag `temperature`". */
    source: string | null;
    /** ISO date, when the source records one. */
    measuredAt: string | null;
    /**
     * A word rather than a number: "hot", "warm", "scalding". This is what the
     * majority of mapped springs actually carry. Keeping it separate from
     * `celsius` means the UI can say "described as hot, never measured" instead
     * of a bare Unknown — the difference between nobody having looked and
     * somebody having looked without a thermometer.
     */
    qualitative: string | null;
  };
  access: {
    /** Free-form and human-facing: "Free", "$15 USD", "Donation", null. */
    price: string | null;
    /** ISO 4217 when the price is a known amount in a known currency. */
    currency: string | null;
    notes: string | null;
    /**
     * What the agency that manages the land permits. Set by the land-manager
     * stage of the build from data/land-managers.json, never from OSM tags:
     * `access=yes` on a Yellowstone geyser means the ground is walkable, not
     * that the water is.
     */
    status: AccessStatus;
    /**
     * Whether entering the water is permitted. `false` is a prohibition the
     * UI must state before anything else; `null` is genuinely unknown and
     * says nothing either way. Mandatory rather than optional so no call site
     * can reach it through an optional chain that quietly yields undefined —
     * `spring.access.bathingAllowed === false` is the only test that matters
     * and it must not be defeated by a missing field.
     */
    bathingAllowed: boolean | null;
  };
  clothing: {
    policy: ClothingPolicy;
    /** e.g. "Clothing optional after 8pm", "Mixed days: Tue/Thu". */
    schedule: string | null;
    notes: string | null;
  };
  hours: {
    /** Free-form or OSM opening_hours syntax. */
    open: string | null;
    seasonalNotes: string | null;
    status: HoursStatus;
  };
  /**
   * Water chemistry, as published by a source. Never measured by this atlas.
   *
   * Concentrations are mg/L, the unit every published analysis uses. Every
   * field is independently nullable because sources publish wildly different
   * subsets: a Japanese onsen must post its 泉質 classification by law, a
   * Parks Canada page lists its top five constituents, and most springs
   * publish nothing at all.
   *
   * `measuredAt` is what keeps the display honest. Present means the source
   * states when the water was analysed; absent means it published a
   * composition without saying when, and the UI says that rather than
   * implying the figures are current. Water chemistry drifts.
   */
  minerals: {
    /** 0-14. Onsen exist at pH 1.5; this is a safety figure, not trivia. */
    ph: number | null;
    /** Total dissolved solids, mg/L. The best single summary of strength. */
    tds: number | null;
    sulfate: number | null;
    bicarbonate: number | null;
    chloride: number | null;
    calcium: number | null;
    magnesium: number | null;
    sodium: number | null;
    silica: number | null;
    iron: number | null;
    /** Japan's Hot Spring Law classification. Adopted, not invented. */
    types: MineralType[];
    /** Constituents outside the standard panel, verbatim from the source. */
    notes: string | null;
    /** ISO date the source states the water was analysed. */
    measuredAt: string | null;
  };
  type: SpringType;
  /**
   * ALWAYS false in the public dataset. True unicorns are never stored, never
   * geocoded, never committed. The field exists so that the guarantee is
   * machine-checkable, not so that it can be flipped.
   */
  unicorn: false;
  /** True only after a human has checked the record against a primary source. */
  verified: boolean;
  /** ISO date of the last verification or ingest. */
  lastVerified: string;
  /** Public source URLs or citations. Never empty. */
  sources: string[];
  photos?: string[];
  description: string | null;
  tags: string[];
  warnings: string[];
  /** Provenance and confidence, so the UI can be honest about data quality. */
  quality: DataQuality;
}

export type AccessStatus = 'public' | 'permit' | 'view-only' | 'closed' | 'unknown';
export type ClothingPolicy = 'optional' | 'required' | 'textile-only' | 'mixed' | 'unknown';
export type HoursStatus = 'open' | 'seasonal' | 'closed' | 'unknown';
export type SpringType = 'natural' | 'developed' | 'resort' | 'wild' | 'unknown';

/**
 * A data source a record can be built from.
 *
 * One member, because there is one normaliser. This is the same vocabulary
 * `scripts/lib/identity.mjs` established for the registry's `sourceRefs`
 * (`OSM_PROVIDER`), restated here rather than extended: a second, longer list
 * of providers nothing produces is exactly the divergence that `access.price`
 * and the `osmRefs` projection each had to be taught the hard way. A closed
 * union is also the only thing that will make `tsc` object if a provider is
 * added on one side of that seam and not the other.
 */
export type SourceProvider = 'osm';

export interface DataQuality {
  /**
   * Every machine ingest pipeline that contributed to this record,
   * deduplicated and in sorted order. Never empty.
   *
   * A list rather than one value because a record can be assembled from more
   * than one source — coordinates from a map, the evidence that the water is
   * thermal from a government page — and naming only one of those would be
   * schema-valid and false. Today every record is `['osm']`, which is the
   * complete and honest answer while OSM is the only source.
   */
  provenance: SourceProvider[];
  /**
   * 0-100. Rises with the number of first-class fields (temperature, price,
   * hours, clothing policy) that carry a real value rather than Unknown.
   */
  completeness: number;
  /** Which first-class fields are actually known. */
  known: string[];
  /** True when at least one curated claim was applied to this record. */
  curated?: boolean;
  /** ISO date the record was ingested. */
  ingestedAt: string;
}

/** Temperature bands used for map colouring and the temperature filter. */
export const TEMP_BANDS = [
  { id: 'cool', label: 'Cool', maxC: 30, color: '#5b8fc9' },
  { id: 'warm', label: 'Warm', maxC: 38, color: '#4bab8f' },
  { id: 'hot', label: 'Hot', maxC: 43, color: '#e0a33a' },
  { id: 'very-hot', label: 'Very hot', maxC: 50, color: '#d9663a' },
  { id: 'scalding', label: 'Scalding', maxC: Infinity, color: '#b8332e' },
] as const;

export type TempBandId = (typeof TEMP_BANDS)[number]['id'] | 'unknown';

export const UNKNOWN_TEMP_COLOR = '#8b8478';

export function tempBand(celsius: number | null): TempBandId {
  if (celsius === null || Number.isNaN(celsius)) return 'unknown';
  for (const band of TEMP_BANDS) {
    if (celsius < band.maxC) return band.id;
  }
  return 'scalding';
}

export function bandColor(band: TempBandId): string {
  if (band === 'unknown') return UNKNOWN_TEMP_COLOR;
  return TEMP_BANDS.find((b) => b.id === band)?.color ?? UNKNOWN_TEMP_COLOR;
}
