/**
 * The offline fixture: every spec runs with no network but 127.0.0.1.
 *
 * Every request the browser makes goes through `context.route('**\/*')`.
 * Chromium routes a Web Worker's requests through the same handler as of
 * Playwright 1.63, and that matters here: MapLibre fetches its vector tiles
 * from workers, so a page-only route would let them reach CARTO for real and
 * the harness would quietly depend on the internet.
 *
 * What each third party gets:
 *
 *   127.0.0.1              the real preview server; the dataset can be held
 *   CARTO style            fixtures/carto-style.json, can be held. It keeps
 *                          CARTO's real source, sprite and glyph URLs, so the
 *                          hosts the page contacts are the real ones, with
 *                          the layers cut to background + water
 *   CARTO TileJSON         fixtures/carto-tilejson.json, the real tile URLs
 *   CARTO .mvt tiles       an empty 200: a tile with nothing in it
 *   CARTO sprite           an empty index and a 1x1 PNG
 *   CARTO glyphs           an empty 200
 *   imagery, terrain       fixtures/terrarium-flat.png (sea level everywhere)
 *   the weather API        a fixed reading
 *   anything else          aborted and recorded in `unrouted`
 *
 * Nothing about a host is written here. Each one is derived from where the
 * app defines it (lib/basemap.ts, lib/scene.ts) or from the style fixture,
 * so the day the app adds a host this file does not know, the request is
 * aborted and recorded, and the harness spec says so.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Route } from '@playwright/test';
import { imagery, STYLE_URL, TERRAIN } from '../../src/lib/basemap.ts';
import { UNITS_KEY, WELCOMED_KEY } from './source.ts';

const FIXTURES = path.join(process.cwd(), 'e2e', 'fixtures');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name));

const STYLE_BODY = read('carto-style.json');
const TILEJSON_BODY = read('carto-tilejson.json');
const FLAT_PNG = read('terrarium-flat.png');
const SPRITE_PNG = read('sprite.png');

const style = JSON.parse(STYLE_BODY.toString('utf8')) as {
  sources: Record<string, { url?: string }>;
  sprite: string;
  glyphs: string;
};
const tilejson = JSON.parse(TILEJSON_BODY.toString('utf8')) as { tiles: string[] };

/** The fixed part of a URL template, up to its first `{placeholder}`. */
const prefix = (template: string) => template.split('{')[0];
const hostOf = (template: string) => new URL(template.replace(/\{[^}]+\}/g, '0')).host;

const TILEJSON_URLS = new Set(
  Object.values(style.sources).flatMap((s) => (s.url ? [s.url] : [])),
);
const TILE_HOSTS = new Set(tilejson.tiles.map(hostOf));
const GLYPHS = prefix(style.glyphs);
const IMAGERY = (imagery?.tiles ?? []).map(prefix);
const TERRAIN_PREFIXES = TERRAIN.tiles.map(prefix);

/*
 * The weather request is built inline in lib/scene.ts rather than from a
 * constant, so its origin is read from there. Not from THIRD_PARTIES: that
 * list is what the disclosure spec checks the app against, and the fixture
 * leaning on it would turn a missing disclosure into a harness error.
 */
const SCENE = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'scene.ts'), 'utf8');
const WEATHER_HOST = SCENE.match(/`https:\/\/([^/`]+)\/v1\/forecast/)?.[1];
if (!WEATHER_HOST) throw new Error('lib/scene.ts no longer builds an https://<host>/v1/forecast URL; update e2e/support/offline.ts');

/** A fixed weather reading, in the shape fetchSpringWeather reads. */
export const WEATHER = { current: { temperature_2m: 12.5, weather_code: 3 } };

/** The dataset the store fetches on boot. */
export const DATASET_PATH = '/data/hot-springs.geojson';

export const ROUTES = [
  'local',
  'style',
  'tilejson',
  'tile',
  'sprite',
  'glyphs',
  'imagery',
  'terrain',
  'weather',
] as const;
export type RouteName = (typeof ROUTES)[number];

function classify(url: URL): RouteName | null {
  const bare = url.origin + url.pathname;
  if (url.hostname === '127.0.0.1') return 'local';
  if (bare === STYLE_URL) return 'style';
  if (TILEJSON_URLS.has(bare)) return 'tilejson';
  if (TILE_HOSTS.has(url.host) && url.pathname.endsWith('.mvt')) return 'tile';
  if (bare.startsWith(style.sprite)) return 'sprite';
  if (bare.startsWith(GLYPHS)) return 'glyphs';
  if (IMAGERY.some((p) => bare.startsWith(p))) return 'imagery';
  if (TERRAIN_PREFIXES.some((p) => bare.startsWith(p))) return 'terrain';
  if (url.host === WEATHER_HOST) return 'weather';
  return null;
}

/** Cross-origin fetches need this to read a fulfilled body at all. */
const CORS = { 'access-control-allow-origin': '*' };

async function answer(route: Route, name: Exclude<RouteName, 'local'>, url: URL): Promise<void> {
  switch (name) {
    case 'style':
      return route.fulfill({ headers: CORS, contentType: 'application/json', body: STYLE_BODY });
    case 'tilejson':
      return route.fulfill({ headers: CORS, contentType: 'application/json', body: TILEJSON_BODY });
    case 'tile':
    case 'glyphs':
      return route.fulfill({ headers: CORS, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
    case 'sprite':
      return url.pathname.endsWith('.json')
        ? route.fulfill({ headers: CORS, contentType: 'application/json', body: '{}' })
        : route.fulfill({ headers: CORS, contentType: 'image/png', body: SPRITE_PNG });
    case 'imagery':
    case 'terrain':
      return route.fulfill({ headers: CORS, contentType: 'image/png', body: FLAT_PNG });
    case 'weather':
      return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify(WEATHER) });
  }
}

/** A response held back until the spec lets it go. */
export interface Hold {
  /** Resolves when the held request has reached the fixture. */
  requested: Promise<void>;
  release(): void;
}

export interface Offline {
  /** Every host other than 127.0.0.1 the page asked for, answered or not. */
  hosts: Set<string>;
  /** Requests answered, per route. */
  counts: Record<RouteName, number>;
  /** URLs nothing here knows how to answer. They were aborted. */
  unrouted: string[];
  /** Hold the dataset or the style until `release()`. Call before `goto`. */
  hold(what: 'dataset' | 'style'): Hold;
}

type Options = {
  /**
   * Seed localStorage so the page opens as a returning visitor would see it:
   * welcome panel already dismissed, Celsius. Only the welcome spec turns
   * this off.
   */
  seedStorage: boolean;
};

export const test = base.extend<Options & { net: Offline }>({
  seedStorage: [true, { option: true }],

  net: [
    async ({ context, seedStorage }, use) => {
      const counts = Object.fromEntries(ROUTES.map((r) => [r, 0])) as Record<RouteName, number>;
      const hosts = new Set<string>();
      const unrouted: string[] = [];
      const holds = new Map<string, { gate: Promise<void>; release: () => void; arrived: () => void }>();

      const hold = (what: 'dataset' | 'style'): Hold => {
        let release!: () => void;
        let arrived!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const requested = new Promise<void>((r) => (arrived = r));
        holds.set(what, { gate, release, arrived });
        return { requested, release };
      };

      const wait = async (what: 'dataset' | 'style') => {
        const h = holds.get(what);
        if (!h) return;
        h.arrived();
        await h.gate;
      };

      if (seedStorage) {
        await context.addInitScript(
          (entries) => {
            try {
              for (const [k, v] of entries) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
            } catch {
              // An opaque origin (about:blank) has no storage. Nothing to seed.
            }
          },
          [
            [WELCOMED_KEY, '1'],
            [UNITS_KEY, 'c'],
          ] as [string, string][],
        );
      }

      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (!url.protocol.startsWith('http')) return route.continue();
        const name = classify(url);
        if (name !== 'local') hosts.add(url.host);
        if (name === null) {
          unrouted.push(url.href);
          return route.abort('blockedbyclient');
        }
        counts[name] += 1;
        try {
          if (name === 'local') {
            if (url.pathname === DATASET_PATH) await wait('dataset');
            return await route.continue();
          }
          if (name === 'style') await wait('style');
          return await answer(route, name, url);
        } catch (err) {
          // A held request can outlive its test; the context is gone by then.
          if (!String(err).includes('closed')) throw err;
        }
      });

      await use({ hosts, counts, unrouted, hold });

      for (const h of holds.values()) h.release();
    },
    { auto: true },
  ],
});

export { expect };
