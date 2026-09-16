/**
 * Every raster tile source this app pulls, and the terms each one comes under.
 *
 * This file exists because the atlas got caught doing the thing it criticises.
 * The whole argument of the project is that provenance and licensing are the
 * product — DATA.md names five upstreams and the build asserts the attribution
 * cannot drift from what shipped — while the map was quietly streaming Esri's
 * World Imagery from `server.arcgisonline.com` with no key, no subscription
 * and no licence.
 *
 * Esri's product-specific terms (E300) scope basemap content to use *with*
 * Esri platform services: "Basemap Styles are for use only with ArcGIS
 * Location Platform Basemap Services." Keyless third-party consumption is at
 * best unlicensed and at worst prohibited. "It returns tiles without a token"
 * is not a licence grant, and a project whose credibility rests on getting
 * this right does not get to make that argument.
 *
 * So imagery is now a named choice with its terms attached, and swapping it is
 * one constant.
 *
 * ── The choice, honestly stated ──────────────────────────────────────────
 * There is no high-resolution, keyless, commercially-unrestricted global
 * imagery basemap. That option does not exist; anyone who tells you otherwise
 * is describing an unlicensed one. The three real positions:
 *
 *   's2cloudless'  ESA Sentinel-2, composited and served by EOX. ~10 m/px,
 *                  keyless, free — but the free grant is CC BY-NC-SA 4.0.
 *                  NON-COMMERCIAL. Fine while this atlas is free and open;
 *                  a licence to buy from EOX the day it is not. EOX also
 *                  rate-limits the public endpoint and says so.
 *   'none'         No imagery. Zero licensing exposure, zero dependency,
 *                  and the dark basemap carries every zoom. The defensible
 *                  choice if this ever becomes a commercial product and the
 *                  imagery budget is zero.
 *   'esri'         What was here. Retained only so the diff is legible.
 *                  DO NOT SHIP. See above.
 *
 * Default is 's2cloudless': the atlas is free, open and ODbL today, so the NC
 * grant is satisfied today, and the terms are stated in the UI rather than
 * assumed. Change one line to 'none' if that stops being true.
 */

export type ImageryProvider = 's2cloudless' | 'none' | 'esri';

export const IMAGERY: ImageryProvider = 's2cloudless';

export interface ImagerySource {
  tiles: string[];
  attribution: string;
  maxzoom: number;
  /** Shown in the licence panel. Plain language, not a licence identifier alone. */
  terms: string;
}

const SOURCES: Record<ImageryProvider, ImagerySource | null> = {
  /** No imagery layer at all. The dark basemap carries every zoom. */
  none: null,

  /**
   * EOX Sentinel-2 cloudless. Attribution string is the one EOX's licence
   * documentation specifies, including the Copernicus notice — the ShareAlike
   * grant conditions use on carrying it, so it is not decorative.
   *
   * maxzoom 14: Sentinel-2 is 10 m/px and the service stops there. MapLibre
   * overzooms past it, which is honest blur rather than invented detail —
   * preferable to a provider that upsamples and implies resolution it does
   * not have.
   */
  s2cloudless: {
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
    attribution:
      'Sentinel-2 cloudless 2020 by <a href="https://cloudless.eox.at/" target="_blank" rel="noreferrer noopener">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2020), CC BY-NC-SA 4.0',
    maxzoom: 14,
    terms:
      'Imagery is Sentinel-2 cloudless 2020 by EOX IT Services GmbH, containing modified Copernicus Sentinel data 2020, used under CC BY-NC-SA 4.0. Non-commercial use only.',
  },

  /** Unlicensed. Here as a record of what was removed, never as a default. */
  esri: {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    maxzoom: 19,
    terms: 'UNLICENSED — Esri basemap content is scoped to ArcGIS platform services. Do not ship.',
  },
};

export const imagery: ImagerySource | null = SOURCES[IMAGERY];

/**
 * CARTO dark-matter. Keyless and explicitly offered for third-party use under
 * CARTO's basemap terms, with attribution rendered by MapLibre from the style
 * itself. Unlike the imagery above, this one was always fine.
 */
export const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/**
 * Terrain DEM. AWS Open Data Terrain Tiles (the former Mapzen set): open
 * licences per contributing source, attribution required, no key. This one
 * was fine too; it is listed here so that every tile this app requests has
 * its terms in one file rather than in three comments.
 */
export const TERRAIN: { tiles: string[]; attribution: string; terms: string } = {
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  attribution:
    '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer noopener">Terrain Tiles</a> (AWS Open Data) — NASA SRTM, USGS, NRCan and others',
  terms:
    'Elevation from AWS Open Data Terrain Tiles, assembled from NASA SRTM, USGS 3DEP, NRCan CDEM and other national sources, each public domain or openly licensed.',
};

/**
 * Live air temperature beside the water temperature on a card.
 * Open-Meteo, CC BY 4.0, keyless, non-commercial tier is free.
 */
export const WEATHER_TERMS =
  'Live air temperature from Open-Meteo, CC BY 4.0. Requested per spring when a card is opened.';

/** Every third party a visitor's browser contacts. The privacy page renders from this. */
export const THIRD_PARTIES: { host: string; what: string; when: string }[] = [
  { host: 'basemaps.cartocdn.com', what: 'CARTO — the dark basemap', when: 'on every page load' },
  ...(imagery
    ? [{ host: new URL(imagery.tiles[0].replace(/\{[^}]+\}/g, '0')).host, what: 'satellite imagery', when: 'when you zoom past street level' }]
    : []),
  { host: 's3.amazonaws.com', what: 'AWS Open Data — elevation tiles for 3D terrain', when: 'when you zoom past street level' },
  { host: 'api.open-meteo.com', what: 'Open-Meteo — current air temperature at the spring', when: 'when you open a spring card' },
];
