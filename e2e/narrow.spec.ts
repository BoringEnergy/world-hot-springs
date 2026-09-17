/**
 * A phone: 375x812, touch, and motion on, because the regression this file
 * exists for lived in the flight and reduced motion skips the flight.
 *
 *   selecting a result keeps the page     mutation: `padding: ... : undefined`,
 *                                         passed to flyTo as the key
 *   no sideways page scroll, 320 and 375  mutation: the app root `w-full` ->
 *                                         `w-[400px]`
 *   the card fits and can be closed       mutation: the card's `inset-x-0` ->
 *                                         `left-0 w-[420px]`
 *
 * B0 (e2e/README.md) measured no page overflow at 320 or 375:
 * documentElement.scrollWidth equalled the viewport. So that is asserted
 * here rather than pinned. The footer scrolls inside itself at 320; that is
 * D12, in footer.spec.ts.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './support/offline.ts';
import { waitForData, waitForMap } from './support/map.ts';
import { record } from './support/records.ts';
import { href } from '../src/lib/router.ts';

const RADIUM = record('radium');

test.use({
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
  reducedMotion: 'no-preference',
});

const card = (page: Page) => page.getByRole('complementary', { name: `Details for ${RADIUM.name}` });

test('selecting a search result on a phone opens the card and the page survives the flight', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await waitForMap(page);
  await waitForData(page);

  await page.getByRole('textbox', { name: 'Search hot springs' }).fill(RADIUM.name!);
  await page.getByRole('main').getByRole('button', { name: new RegExp(`^${RADIUM.name}`) }).first().tap();
  await expect(card(page)).toBeVisible();

  /*
   * 2026-09-03: `padding: undefined` reached flyTo on narrow screens, MapLibre
   * read `.top` off it and threw, and React unmounted the whole tree -- a
   * blank page one tap after a search. The throw happens as the flight
   * starts, so wait until the flight is under way or the page has gone.
   */
  await page.waitForFunction(() => (window.__map?.getZoom() ?? 0) > 4 || !document.querySelector('header'));
  expect(errors, 'uncaught exceptions during the flight').toEqual([]);
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(card(page)).toBeVisible();
});

for (const width of [320, 375]) {
  test(`at ${width} px the page does not scroll sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/');
    await waitForMap(page);
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - window.innerWidth,
      body: document.body.scrollWidth - window.innerWidth,
    }));
    expect(overflow).toEqual({ doc: 0, body: 0 });
  });
}

test('on a phone the card lies inside the screen and its close button can be pressed', async ({ page }) => {
  await page.goto(href({ kind: 'spring', id: RADIUM.id }));
  await expect(card(page)).toBeVisible();

  /*
   * Below `lg` the card is a full-width bottom sheet, so "narrower than the
   * screen by a margin" is the wrong test. It has to be inside the screen,
   * and its close button has to be the thing a tap lands on.
   */
  const box = (await card(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(box.y + box.height).toBeLessThanOrEqual(812);

  const close = card(page).getByRole('button', { name: 'Close details' });
  const hit = await close.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { inside: x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight, reaches: !!top && el.contains(top) };
  });
  expect(hit).toEqual({ inside: true, reaches: true });

  await close.tap();
  await expect(card(page)).toBeHidden();
});
