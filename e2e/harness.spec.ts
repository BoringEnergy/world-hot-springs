/**
 * The harness itself. If any of these fail, every other spec's result means
 * nothing, so read these first.
 *
 *   server is the e2e build     mutation: preview:e2e serves dist/ instead
 *   WebGL is available          mutation: --disable-gpu --disable-software-rasterizer
 *   every request intercepted   mutation: the .mvt route removed from offline.ts
 *
 * Each was applied and watched failing on 2026-09-16; see e2e/README.md.
 */
import { test, expect } from './support/offline.ts';
import { waitForMap } from './support/map.ts';

test('the server is the e2e build: MapView exposes window.__map', async ({ page }) => {
  await page.goto('/');
  // Polled rather than read once: the hook is set when the style has parsed,
  // which is after the first paint.
  await expect
    .poll(() => page.evaluate(() => typeof window.__map), {
      message:
        'window.__map never appeared, so this is not the e2e build. The web server must run ' +
        '`npm run build:e2e` (vite --mode e2e) and serve dist-e2e/; a plain dist/ carries no hooks.',
      timeout: 15_000,
    })
    .toBe('object');
});

test('WebGL is available to the page', async ({ page }) => {
  await page.goto('/');
  const gl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const ctx = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!ctx) return null;
    const info = ctx.getExtension('WEBGL_debug_renderer_info');
    return String(info ? ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER));
  });
  // Measured 2026-09-16, Windows, headless shell 1243:
  //   ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) ...), SwiftShader driver)
  test.info().annotations.push({ type: 'webgl renderer', description: gl ?? 'none' });
  expect(
    gl,
    'no WebGL context, so MapLibre cannot draw at all. A CI runner has no GPU; Chromium needs its ' +
      'software renderer, SwiftShader (--enable-unsafe-swiftshader, which Playwright 1.63 passes by ' +
      'default). Check nothing in playwright.config.ts disables it.',
  ).not.toBeNull();
});

test('every third-party request is intercepted, including the tiles fetched from a worker', async ({ page, net }) => {
  await page.goto('/');
  await waitForMap(page);
  await page.waitForFunction(() => document.documentElement.dataset.mapReady === 'true');

  // Ten tile requests per cold load at 1280x720, measured 2026-09-16.
  expect(net.counts.tile, 'no vector tile reached the fixture').toBeGreaterThan(0);

  // A fetch made inside a Web Worker is on the worker's resource timeline,
  // not the page's. So tiles the fixture answered that the page never saw
  // were requested by MapLibre's worker -- the path a page-only route misses.
  const tilesSeenByPage = await page.evaluate(
    () => performance.getEntriesByType('resource').filter((e) => e.name.endsWith('.mvt')).length,
  );
  expect(tilesSeenByPage, 'tiles were fetched from the page, so this proves nothing about workers').toBe(0);

  expect(net.unrouted, 'requests the offline fixture does not know how to answer').toEqual([]);
});
