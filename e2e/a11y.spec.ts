/**
 * What a screen reader and a keyboard get, in a browser that lays the page
 * out. scripts/a11y.test.mjs reads the source; it cannot see a `hidden`
 * class switch an element off at one width and on at another.
 *
 *   one h1 at 1440                 mutation: the header's h1 -> h2
 *   one h1 at 375 (was D1)         mutation: the fix reverted, the wordmark
 *                                  span `hidden md:flex` again
 *   every button named at 1440     mutation: the About button's aria-label removed
 *   every button named at 375      mutation: the Filters button's aria-label
 *   (was D2)                       removed; its only text is `hidden sm:inline`
 *
 * Pinned defects (the fix flips each one):
 *
 *   D9  Tab reaches the closed filter rail, which is aria-hidden but not inert
 */
import type { Page } from '@playwright/test';
import { test, expect } from './support/offline.ts';
import { waitForData, waitForMap } from './support/map.ts';

async function load(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await waitForMap(page);
  await waitForData(page);
}

/** The header's filter toggle, found by what it does rather than what it says. */
const filtersButton = (page: Page) => page.getByRole('banner').locator('button[aria-pressed]');

for (const [width, height] of [
  [1440, 900],
  [375, 812],
]) {
  // At 375 the wordmark's words are out of sight, and the h1 among them must
  // still be in the accessibility tree: `sr-only`, never display:none.
  test(`at ${width} px the page has exactly one h1`, async ({ page }) => {
    await load(page, width, height);
    await expect(page.getByRole('heading', { level: 1 }), 'the accessibility tree has no single h1').toHaveCount(1);
  });
}

for (const [width, height] of [
  [1440, 900],
  [375, 812],
]) {
  test(`at ${width} px every button has an accessible name`, async ({ page }) => {
    await load(page, width, height);
    const buttons = page.getByRole('button');
    const n = await buttons.count();
    expect(n, 'no buttons found: the page did not render').toBeGreaterThan(5);
    for (let i = 0; i < n; i++) {
      const b = buttons.nth(i);
      await expect(b, `button ${i}: ${await b.evaluate((el) => el.outerHTML.slice(0, 120))}`).toHaveAccessibleName(/\S/);
    }
    // Below 640 px its visible word is display:none; from 640 up the label
    // and the word are the same, and the name must not read it twice.
    await expect(filtersButton(page)).toBeVisible();
    await expect(filtersButton(page)).toHaveAccessibleName('Filters', { exact: true });
  });
}

test('known defect D9: Tab reaches the closed filter rail', async ({ page }) => {
  await load(page, 1440, 900);
  await expect(filtersButton(page)).toHaveAttribute('aria-pressed', 'false');

  // Everything focusable in the page is fewer than 60 stops away; the rail
  // follows the header and the map in document order.
  let reached = '';
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => {
      // The rail specifically: the hidden container whose heading is Filters.
      // Any other aria-hidden focus trap is a different defect, and must not
      // keep this pin green after the rail is fixed.
      const el = document.activeElement;
      const hidden = el?.closest('[aria-hidden="true"]');
      const isRail = [...(hidden?.querySelectorAll('h2') ?? [])].some((h) => h.textContent?.trim() === 'Filters');
      return el && isRail ? el.outerHTML.slice(0, 80) : '';
    });
  }
  expect(reached, 'keyboard focus landed inside the closed, aria-hidden filter rail').not.toBe('');
});
