/**
 * Reading the map through the hooks MapView exposes in the e2e build.
 *
 * `window.__map` is the MapLibre instance itself. Specs ask it questions
 * rather than counting pixels: SwiftShader's output varies by platform, and a
 * canvas screenshot says nothing about which record the camera is on.
 */
import type { Page } from '@playwright/test';
import type { Map as MapLibreMap } from 'maplibre-gl';

declare global {
  interface Window {
    __map?: MapLibreMap;
  }
}

/** Resolves once MapView has added its sources, which is after the style parsed. */
export async function waitForMap(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__map?.getSource('springs'));
}

/** How many features the clustered springs source holds right now. */
export async function springsInSource(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const src = window.__map?.getSource('springs') as
      | { getData(): Promise<{ type: string; features?: unknown[] }> }
      | undefined;
    if (!src) return -1;
    const data = await src.getData();
    return data.type === 'FeatureCollection' ? (data.features?.length ?? -1) : -1;
  });
}

/** Where the camera is: centre, zoom, and whether it is still moving. */
export async function camera(page: Page): Promise<{ lng: number; lat: number; zoom: number; moving: boolean }> {
  return page.evaluate(() => {
    const m = window.__map!;
    const c = m.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: m.getZoom(), moving: m.isMoving() };
  });
}

/**
 * The globe's extent on the map canvas, in canvas pixels.
 *
 * The limb is found by projecting great-circle arcs of 0 to 90 degrees out
 * from the camera centre along 8 bearings and keeping the extremes: the
 * method B0 used (e2e/README.md), so the measured margins and this agree.
 */
export async function globeBox(page: Page): Promise<{
  canvas: { width: number; height: number };
  radius: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}> {
  return page.evaluate(() => {
    const m = window.__map!;
    const c = m.getCenter();
    const rect = m.getCanvas().getBoundingClientRect();
    const origin = m.project(c);
    const rad = Math.PI / 180;
    const lat1 = c.lat * rad;
    let radius = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let b = 0; b < 8; b++) {
      const bearing = b * 45 * rad;
      for (let d = 0; d <= 90; d++) {
        const arc = d * rad;
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(arc) + Math.cos(lat1) * Math.sin(arc) * Math.cos(bearing));
        const lng2 =
          c.lng * rad +
          Math.atan2(Math.sin(bearing) * Math.sin(arc) * Math.cos(lat1), Math.cos(arc) - Math.sin(lat1) * Math.sin(lat2));
        const p = m.project([((lng2 / rad + 540) % 360) - 180, lat2 / rad]);
        radius = Math.max(radius, Math.hypot(p.x - origin.x, p.y - origin.y));
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    return { canvas: { width: rect.width, height: rect.height }, radius, minX, maxX, minY, maxY };
  });
}

/** Resolves once MapLibre has gone idle with everything it asked for loaded. */
export async function waitForIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.mapReady === 'true');
}

/** Resolves once the store has the dataset: the header's live count says so. */
export async function waitForData(page: Page): Promise<void> {
  await page.waitForFunction(() => /\bshown$/.test(document.querySelector('header [role=status]')?.textContent ?? ''));
}
