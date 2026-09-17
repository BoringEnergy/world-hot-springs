/**
 * The footer: the key, and the links that must never be out of reach.
 *
 *   Safety is on screen and takes the click, 320-1440
 *                               mutation: the Safety link moved last in the nav
 *   each page opens, by click and by cold load
 *                               mutation: the Terms and Privacy hrefs swapped
 *   Download is the dataset     mutation: the href points at .json
 *   the key at every width      mutations: the key group `hidden sm:flex`
 *                               again (D11, fails at 320 and 375); the
 *                               swatch colours read from a copied list
 *   every link on screen and    mutation: the footer's old single
 *   clickable, and no sideways  `overflow-x-auto` row, without wrapping
 *   scroll, 320-1440            (D12 at 320 and 375-F, D12b at 800)
 *
 * Positions measured in B0 on 2026-09-16, before the fix (e2e/README.md,
 * "Footer links"), viewport height 800:
 *
 *   width  footer scroll   Safety x         off-screen
 *   320    373 in 320      12.0 - 50.9      Source, 319.9 - 361.1
 *   375    none            13.0 - 51.9      none (Source ends at 362.0)
 *   800    836 in 800      471.0 - 509.9    Source, 778.8 - 820.0
 *   1100   none            735.0 - 773.9    none
 *   1440   none            1075.0 - 1113.9  none
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './support/offline.ts';
import { waitForMap } from './support/map.ts';
import { pageTitle, tabLabel, UNITS_KEY, type StandingPage } from './support/source.ts';
import { href } from '../src/lib/router.ts';
import { TEMP_BANDS, UNKNOWN_TEMP_COLOR, UNKNOWN_TEMP_LABEL } from '../src/lib/types.ts';

const WIDTHS = [320, 375, 640, 800, 1100, 1440];
const HEIGHT = 800;

const footer = (page: Page) => page.getByRole('contentinfo');
const footerLink = (page: Page, name: string) => footer(page).getByRole('link', { name, exact: true });
const keyGroup = (page: Page) =>
  footer(page).getByRole('group', { name: 'Water temperature key', includeHidden: true });

/** The footer's own words for each page, which are shorter than the pages' titles. */
const LINK_TEXT: Record<StandingPage, string> = { safety: 'Safety', about: 'About', terms: 'Terms', privacy: 'Privacy' };

/** Where an element sits horizontally, and whether a click at its centre reaches it. */
async function placement(link: Locator) {
  return link.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { left: r.left, right: r.right, width: r.width, hit: !!hit && el.contains(hit) };
  });
}

for (const width of WIDTHS) {
  test(`at ${width} px the Safety link is on screen and takes the click`, async ({ page }) => {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.goto('/');
    await waitForMap(page);

    const safety = footerLink(page, LINK_TEXT.safety);
    const at = await placement(safety);
    expect(at.width, 'the Safety link has no size').toBeGreaterThan(0);
    expect(at.left, 'the Safety link starts off the left edge').toBeGreaterThanOrEqual(0);
    expect(at.right, 'the Safety link runs off the right edge').toBeLessThanOrEqual(width);
    expect(at.hit, 'something else is on top of the Safety link').toBe(true);

    await safety.click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: tabLabel('safety') })).toBeVisible();
  });
}

/*
 * After the fix, measured 2026-09-17 on Windows (Segoe UI; no web font
 * loads, so Linux positions differ and none is pinned here). On a phone the
 * footer is two rows, key then links, 56 px tall; from 640 to 1023 the links
 * wrap under the key (54 px); from 1024 it is one row (33.5 px).
 *
 *   width  links row           key contents (C / F), gaps included
 *   320    17.0 - 303.0        256.5 / 290.7 in 296
 *   375    44.5 - 330.5        302.9 / 337.1 in 351
 *
 * The key row may wrap if a wider system font needs it, so the assertions
 * are containment and hit-testing, which hold for any font.
 */
for (const units of ['c', 'f'] as const) {
  for (const width of WIDTHS) {
    test(`at ${width} px (°${units.toUpperCase()}) every footer link is on screen and takes a click, and the footer does not scroll sideways`, async ({ page }) => {
      await page.addInitScript(([k, u]) => localStorage.setItem(k, u), [UNITS_KEY, units]);
      await page.setViewportSize({ width, height: HEIGHT });
      await page.goto('/');
      await waitForMap(page);

      const links = footer(page).getByRole('link');
      expect(await links.count(), 'the footer has no links').toBe(Object.keys(LINK_TEXT).length + 2);
      for (const link of await links.all()) {
        const name = await link.evaluate((el) => el.getAttribute('aria-label') ?? el.textContent);
        const at = await placement(link);
        expect(at.width, `${name} has no size`).toBeGreaterThan(0);
        expect(at.left, `${name} starts off the left edge`).toBeGreaterThanOrEqual(0);
        expect(at.right, `${name} runs off the right edge`).toBeLessThanOrEqual(width);
        expect(at.hit, `a click at the centre of ${name} lands on something else`).toBe(true);
      }
      const overflow = await page.evaluate(() => {
        const f = document.querySelector('footer')!;
        return { footer: f.scrollWidth - f.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth };
      });
      expect(overflow, 'something scrolls sideways').toEqual({ footer: 0, page: 0 });
    });
  }
}

const PAGES: StandingPage[] = ['safety', 'about', 'terms', 'privacy'];

/** The About panel with `page`'s tab current, and the page's title. */
async function expectPage(page: Page, which: StandingPage) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: tabLabel(which), exact: true })).toHaveAttribute('aria-current', 'page');
  // Legal pages are headed with their own name; About is headed with the atlas's.
  if (which !== 'about') await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(tabLabel(which));
  await expect(page).toHaveTitle(pageTitle(which));
  await expect(page).toHaveURL(href({ kind: 'page', page: which }));
}

for (const which of PAGES) {
  test(`the ${which} link opens its page, by click and by cold load`, async ({ page }) => {
    await page.goto('/');
    await waitForMap(page);
    const link = footerLink(page, LINK_TEXT[which]);
    await expect(link).toHaveAttribute('href', href({ kind: 'page', page: which }));

    await link.click();
    await expectPage(page, which);

    // A crawler, a new tab, a pasted link: the href on its own.
    await page.goto((await link.getAttribute('href'))!);
    await expectPage(page, which);
  });
}

test('Download the data is the published dataset, byte for byte', async ({ page }) => {
  await page.goto('/');
  const link = footerLink(page, 'Download the data');
  await expect(link).toHaveAttribute('download', '');

  const res = await page.request.get((await link.getAttribute('href'))!);
  expect(res.status()).toBe(200);
  const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
  expect(sha(await res.body()), 'the download is not data/hot-springs.geojson').toBe(
    sha(fs.readFileSync('data/hot-springs.geojson')),
  );
});

/** `#rrggbb` as the rgb() a computed style reports. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

// Every band, then "No reading": the key and the map read the same list.
const KEY_COLOURS = [...TEMP_BANDS.map((b) => b.color), UNKNOWN_TEMP_COLOR].map(rgb);
const KEY_NAMES = [...TEMP_BANDS.map((b) => b.label as string), UNKNOWN_TEMP_LABEL];

for (const width of WIDTHS) {
  test(`at ${width} px the key shows a swatch for every band and for no reading`, async ({ page }) => {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.goto('/');
    await waitForMap(page);
    const key = keyGroup(page);
    await expect(key, 'the map colours have no key at this width').toBeVisible();
    const swatches = await key.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>('span[style]')].map((s) => ({
        colour: getComputedStyle(s).backgroundColor,
        title: s.parentElement?.getAttribute('title') ?? '',
        shown: s.getBoundingClientRect().width > 0,
      })),
    );
    expect(swatches.map((s) => s.colour)).toEqual(KEY_COLOURS);
    expect(swatches.every((s) => s.shown), 'a swatch has no size').toBe(true);
    // Each swatch names its band, whatever its visible text is at this width.
    expect(swatches.map((s) => s.title.split(' — ')[0])).toEqual(KEY_NAMES);
    const inside = await key.evaluate((el, w) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= w;
    }, width);
    expect(inside, 'the key runs off the screen').toBe(true);
  });
}
