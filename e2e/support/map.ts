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
