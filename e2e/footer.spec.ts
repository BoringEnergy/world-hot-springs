/**
 * The footer: the key, and the links that must never be out of reach.
 *
 *   Safety is on screen and takes the click, 320-1440
 *                               mutation: the Safety link moved last in the nav
 *   each page opens, by click and by cold load
 *                               mutation: the Terms and Privacy hrefs swapped
 *   Download is the dataset     mutation: the href points at .json
 *   the key from 640 px up      mutation: `sm:flex` -> `md:flex`
 *
 * Pinned defects (the fix flips each one):
 *
 *   D11  no temperature key below 640 px. Hudson decided on 2026-09-16 that
 *        phones get a compact key; until track C builds it, the key group is
 *        display:none at 320 and 375.
 *   D12  the footer's links overflow at 320 px: Source sits past the right
 *        edge inside a footer that scrolls sideways. The page itself does not
 *        overflow.
 *   D12b the same at 800 px, where Source is cut by the edge.
 *
 * Positions measured in B0 on 2026-09-16 (e2e/README.md, "Footer links"),
 * viewport height 800:
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
import { pageTitle, tabLabel, type StandingPage } from './support/source.ts';
import { href } from '../src/lib/router.ts';
import { TEMP_BANDS, UNKNOWN_TEMP_COLOR } from '../src/lib/types.ts';

const WIDTHS = [320, 375, 800, 1100, 1440];
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

test('known defect D12: footer links overflow at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: HEIGHT });
  await page.goto('/');
  await waitForMap(page);

  const source = await placement(footerLink(page, 'Source'));
  // B0: 319.9 to 361.1.
  expect(source.right, 'Source is past the right edge').toBeGreaterThan(320);
  const sizes = await page.evaluate(() => {
    const f = document.querySelector('footer')!;
    return { footer: f.scrollWidth - f.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth };
  });
  expect(sizes.footer, 'the footer scrolls sideways (B0: 373 in 320)').toBeGreaterThan(0);
  expect(sizes.page, 'the page itself does not overflow').toBe(0);
});

test('known defect D12b: footer links overflow at 800px', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: HEIGHT });
  await page.goto('/');
  await waitForMap(page);

  const source = await placement(footerLink(page, 'Source'));
  // B0 on Windows: 778.8 to 820.0, cut by the edge. Where it starts depends on
  // the system font -- no web font loads -- and with Linux-like metrics it sits
  // wholly past the edge (Arial 804.0-846.8, Verdana 869.2-915.4). Only the
  // right edge is common to every font measured, so only it is pinned.
  expect(source.right, 'Source reaches past the right edge').toBeGreaterThan(800);
});

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

for (const width of [640, 800, 1100, 1440]) {
  test(`at ${width} px the key shows a swatch for every band and for no reading`, async ({ page }) => {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.goto('/');
    const key = keyGroup(page);
    await expect(key).toBeVisible();
    const colours = await key.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>('span[style]')].map((s) => getComputedStyle(s).backgroundColor),
    );
    expect(colours).toEqual(KEY_COLOURS);
  });
}

for (const width of [320, 375]) {
  // Hudson, 2026-09-16: phones get a compact key. Track C builds it; this
  // test then becomes "the key is visible and names every band".
  test(`known defect D11: no temperature key below 640px (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.goto('/');
    await waitForMap(page);
    await expect(keyGroup(page)).toBeAttached();
    await expect(keyGroup(page), 'a phone gets no key to the map colours').toBeHidden();
  });
}
