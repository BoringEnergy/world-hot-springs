/**
 * On arrival, the whole planet is on screen.
 *
 *   fits at 1440x900 and 1280x720   mutation: the constructor's `zoom: 2.3`
 *
 * Pinned defect (the fix flips it):
 *
 *   D13  the arrival globe is wider than a phone
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
 * pixels are the margin a regression has to eat before this fails. At 2.3
 * the 1280x720 radius would be 258.6 x 2^0.3 = 318, taller than the canvas.
 */
import { test, expect } from './support/offline.ts';
import { globeBox, waitForMap } from './support/map.ts';

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
]) {
  test(`at ${width}x${height} the globe fits inside the map on arrival`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await waitForMap(page);
    const g = await globeBox(page);
    test.info().annotations.push({ type: 'globe', description: JSON.stringify(g) });
    expect(g.radius, 'no globe was measured').toBeGreaterThan(100);
    expect(g.minX, 'the globe is cut off on the left').toBeGreaterThanOrEqual(0);
    expect(g.maxX, 'the globe is cut off on the right').toBeLessThanOrEqual(g.canvas.width);
    expect(g.minY, 'the globe is cut off at the top').toBeGreaterThanOrEqual(0);
    expect(g.maxY, 'the globe is cut off at the bottom').toBeLessThanOrEqual(g.canvas.height);
  });
}

test('known defect D13: the arrival globe is wider than a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await waitForMap(page);
  const g = await globeBox(page);
  test.info().annotations.push({ type: 'globe', description: JSON.stringify(g) });
  // B0: x from -78.3 to 453.3 in a 375 px canvas; it does fit vertically.
  expect(g.minX, 'the globe runs off the left of a phone').toBeLessThan(0);
  expect(g.maxX, 'the globe runs off the right of a phone').toBeGreaterThan(g.canvas.width);
  expect(g.minY).toBeGreaterThanOrEqual(0);
  expect(g.maxY).toBeLessThanOrEqual(g.canvas.height);
});
