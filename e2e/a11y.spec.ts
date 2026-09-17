/**
 * What a screen reader and a keyboard get, in a browser that lays the page
 * out. scripts/a11y.test.mjs reads the source; it cannot see a `hidden`
 * class switch an element off at one width and on at another.
 *
 *   one h1 at 1440                 mutation: the header's h1 -> h2
 *   every button named at 1440     mutation: the About button's aria-label removed
 *
 * Pinned defects (the fix flips each one):
 *
 *   D1  no h1 at 375: it sits inside the `hidden md:flex` wordmark
 *   D2  the Filters button has no name at 375: its only text is `hidden sm:inline`
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

test('at 1440 px the page has exactly one h1', async ({ page }) => {
  await load(page, 1440, 900);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});

test('at 1440 px every button has an accessible name', async ({ page }) => {
  await load(page, 1440, 900);
  const buttons = page.getByRole('button');
  const n = await buttons.count();
  expect(n, 'no buttons found: the page did not render').toBeGreaterThan(5);
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    await expect(b, `button ${i}: ${await b.evaluate((el) => el.outerHTML.slice(0, 120))}`).toHaveAccessibleName(/\S/);
  }
});

test('known defect D1: no h1 at 375px', async ({ page }) => {
  await load(page, 375, 812);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 }), 'the only h1 is display:none on a phone').toHaveCount(0);
});

test('known defect D2: the Filters button has no accessible name at 375px', async ({ page }) => {
  await load(page, 375, 812);
  await expect(filtersButton(page)).toBeVisible();
  await expect(filtersButton(page)).toHaveAccessibleName('');
});

test('known defect D9: Tab reaches the closed filter rail', async ({ page }) => {
  await load(page, 1440, 900);
  await expect(filtersButton(page)).toHaveAttribute('aria-pressed', 'false');

  // Everything focusable in the page is fewer than 60 stops away; the rail
  // follows the header and the map in document order.
  let reached = '';
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.closest('[aria-hidden="true"]') ? el.outerHTML.slice(0, 80) : '';
    });
  }
  expect(reached, 'keyboard focus landed inside an aria-hidden element').not.toBe('');
});
