/**
 * On arrival, the whole planet is on screen, on a laptop and on a phone.
 *
 *   fits at 1440x900, 1280x720,     mutations: the constructor's `zoom: 2.4`
 *   375x812 and 320x640             (2.3 passes; see below) for the first
 *                                   two; frameArrival() removed (D13) for
 *                                   the phones
 *   desktop arrival is still zoom 2 mutation: ARRIVAL_ZOOM 1.9
 *   refitted when turned sideways   mutation: the resize listener removed
 *
 * Measured in B0 on 2026-09-16 (e2e/README.md, "Globe on arrival"), zoom 2,
 * reduced motion, box in canvas pixels:
 *
 *   viewport  canvas     radius  x               y               fits
 *   1440x900  1440x808   271.5   448.5 - 991.5   132.5 - 675.5   yes, 132 px spare
 *   1280x720  1280x628   258.6   381.4 - 898.6   55.4 - 572.6    yes, 55 px spare
 *   375x812   375x720    265.8   -78.3 - 453.3   94.2 - 625.8    no, 78 px past each side
 *
 * The test asks for the globe inside the canvas and nothing more: the spare
 * pixels are the margin a regression has to eat before this fails.
 *
 * The globe does not grow as 2^zoom this far out, so zoom 2.3 -- the value
 * MapView's comment once said overflowed a laptop -- still fits both
 * viewports here, by 10 px at 1280x720 (radius 304.0, y 10.0 to 618.0 in
 * 628). The mutation watched failing is 2.4: radius 320.4, y -6.4 to 634.4,
 * measured 2026-09-16.
 *
 * After D13's fix (2026-09-17) MapView fits the arrival globe to the canvas
 * with 12 px to spare, and never above zoom 2: see ARRIVAL_MEASURED below.
 */
import { test, expect } from './support/offline.ts';
import { globeBox, waitForMap } from './support/map.ts';

/*
 * ARRIVAL_MEASURED, 2026-09-17 after the fix (Windows). The canvas height
 * depends on the header and footer, whose text is in the system font, so
 * none of these numbers is pinned; each test records its own in an
 * annotation.
 *
 *   viewport  canvas    zoom   radius  x               y
 *   1440x900  1440x808  2      271.5   448.5 - 991.5   132.5 - 675.5
 *   1280x720  1280x628  2      258.6   381.4 - 898.6   55.4 - 572.6
 *   375x812   375x697   1.291  175.5   12.0 - 363.0    173.0 - 524.0
 *   320x640   320x525   1.074  148.0   12.0 - 308.0    114.5 - 410.5
 */
for (const [width, height] of [
  [1440, 900],
  [1280, 720],
  [375, 812],
  [320, 640],
]) {
  test(`at ${width}x${height} the globe fits inside the map on arrival`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await waitForMap(page);
    const g = await globeBox(page);
    const zoom = await page.evaluate(() => window.__map!.getZoom());
    test.info().annotations.push({ type: 'globe', description: JSON.stringify({ ...g, zoom }) });
    expect(g.radius, 'no globe was measured').toBeGreaterThan(100);
    expect(g.minX, 'the globe is cut off on the left').toBeGreaterThanOrEqual(0);
    expect(g.maxX, 'the globe is cut off on the right').toBeLessThanOrEqual(g.canvas.width);
    expect(g.minY, 'the globe is cut off at the top').toBeGreaterThanOrEqual(0);
    expect(g.maxY, 'the globe is cut off at the bottom').toBeLessThanOrEqual(g.canvas.height);
    // Only a map too small for it gets less than the desktop framing.
    if (width >= 1280) expect(zoom, 'a desktop no longer arrives at zoom 2').toBe(2);
    else expect(zoom, 'the phone globe was fitted, so it is below zoom 2').toBeLessThan(2);
  });
}

test('a phone turned sideways before anything is touched still shows the whole globe', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await waitForMap(page);
  await page.setViewportSize({ width: 812, height: 375 });
  // The canvas resizes on the next frame, and the refit follows it.
  await expect
    .poll(async () => {
      const g = await globeBox(page);
      return g.minY >= 0 && g.maxY <= g.canvas.height && g.minX >= 0 && g.maxX <= g.canvas.width;
    }, { message: 'the globe no longer fits once the phone is sideways' })
    .toBe(true);
});
