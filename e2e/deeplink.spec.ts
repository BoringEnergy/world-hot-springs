/**
 * Records have addresses, and an address works however it is reached.
 *
 *   cold link, dataset before style   mutation: the descent effect guarded on
 *                                     `!ready.current` with deps [selectedId]
 *                                     -- the race cda3c35 fixed
 *   cold link, style before dataset   mutation: deps [mapReady] only
 *   with motion, the flight settles   mutation: the stage-2 easeTo removed
 *   an unknown id becomes /           mutation: `replace: false`
 *   Back and Forward                  mutation: the onPopState effect removed
 *   a prohibited spring               mutation: the SoakScene guard is `true`
 *
 * The two race tests hold one response until the other has been used, so
 * each ordering happens every run rather than whenever the network feels
 * like it.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './support/offline.ts';
import { camera, waitForData, waitForMap } from './support/map.ts';
import { isUnknownId, record, springTitle } from './support/records.ts';
import { DEFAULT_TITLE } from './support/source.ts';
import { href } from '../src/lib/router.ts';
import { prohibitionNotice } from '../src/lib/format.ts';
import type { HotSpring } from '../src/lib/types.ts';

const RADIUM = record('radium');
const PROHIBITED = record('prohibited');

const card = (page: Page, s: HotSpring) => page.getByRole('complementary', { name: `Details for ${s.name}` });

/**
 * The camera is on the record at `zoom`. Reduced motion jumps straight to
 * zoom 12 (MapView's jumpTo); the flight settles at 12.5. A thousandth of a
 * degree is about 100 m, and a camera that never moved is ~100 degrees away.
 */
async function expectLandedOn(page: Page, s: HotSpring, zoom: number) {
  await expect
    .poll(
      async () => {
        const c = await camera(page);
        return (
          !c.moving &&
          Math.abs(c.lng - s.location.lng) < 1e-3 &&
          Math.abs(c.lat - s.location.lat) < 1e-3 &&
          Math.abs(c.zoom - zoom) < 0.01
        );
      },
      { message: `the camera never settled on ${s.name} at zoom ${zoom}`, timeout: 15_000 },
    )
    .toBe(true);
}

test('a cold deep link lands on the record when the dataset arrives before the style', async ({ page, net }) => {
  const style = net.hold('style');
  await page.goto(href({ kind: 'spring', id: RADIUM.id }));
  await style.requested;

  // The dataset is in and the route applied, with no map to move yet.
  await expect(card(page, RADIUM)).toBeVisible();
  await expect(page).toHaveTitle(springTitle(RADIUM));
  expect(await page.evaluate(() => !!window.__map?.getSource('springs')), 'the style was held').toBe(false);

  style.release();
  await waitForMap(page);
  await expectLandedOn(page, RADIUM, 12);
});

test('a cold deep link lands on the record when the style arrives before the dataset', async ({ page, net }) => {
  const dataset = net.hold('dataset');
  await page.goto(href({ kind: 'spring', id: RADIUM.id }));
  await dataset.requested;

  // The map is set up and has nothing to show or fly to.
  await waitForMap(page);
  await expect(card(page, RADIUM)).toBeHidden();

  dataset.release();
  await expect(card(page, RADIUM)).toBeVisible();
  await expect(page).toHaveTitle(springTitle(RADIUM));
  await expectLandedOn(page, RADIUM, 12);
});

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the flight from a deep link settles top-down on the record', async ({ page }) => {
    await page.goto(href({ kind: 'spring', id: RADIUM.id }));
    await expect(card(page, RADIUM)).toBeVisible();
    // Stage 1 arrives at 10.5, pitched; stage 2 settles at 12.5, flat.
    await expectLandedOn(page, RADIUM, 12.5);
    expect((await page.evaluate(() => window.__map!.getPitch())), 'the camera is still tilted').toBe(0);
  });
});

test('an id that is not in the dataset becomes / without adding a history entry', async ({ page, net }) => {
  const dead = 'whs_000000000000';
  expect(isUnknownId(dead), `${dead} is a real record now; pick another`).toBe(true);

  const dataset = net.hold('dataset');
  await page.goto(href({ kind: 'spring', id: dead }));
  await dataset.requested;
  const entries = await page.evaluate(() => history.length);

  dataset.release();
  await expect(page).toHaveURL(href({ kind: 'map' }));
  await waitForData(page);
  expect(await page.evaluate(() => history.length), 'the dead link is still in history, one Back away').toBe(entries);
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(page).toHaveTitle(DEFAULT_TITLE);
});

test('Back and Forward close and reopen a card', async ({ page }) => {
  await page.goto('/');
  await waitForData(page);

  await page.getByRole('textbox', { name: 'Search hot springs' }).fill(RADIUM.name!);
  await page.getByRole('main').getByRole('button', { name: new RegExp(`^${RADIUM.name}`) }).first().click();
  await expect(page).toHaveURL(href({ kind: 'spring', id: RADIUM.id }));
  await expect(card(page, RADIUM)).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(href({ kind: 'map' }));
  await expect(card(page, RADIUM), 'Back changed the address and left the card open').toBeHidden();
  await expect(page).toHaveTitle(DEFAULT_TITLE);

  await page.goForward();
  await expect(page).toHaveURL(href({ kind: 'spring', id: RADIUM.id }));
  await expect(card(page, RADIUM), 'Forward changed the address and left the card closed').toBeVisible();
  await expect(page).toHaveTitle(springTitle(RADIUM));
});

test('a spring where bathing is prohibited says so, and draws no water to get into', async ({ page }) => {
  expect(PROHIBITED.access.bathingAllowed, 'the "prohibited" card is no longer prohibited').toBe(false);

  await page.goto(href({ kind: 'spring', id: PROHIBITED.id }));
  const aside = card(page, PROHIBITED);
  await expect(aside).toBeVisible();
  // The heading's words are pinned in source by scripts/land-manager.test.mjs.
  await expect(aside.getByRole('heading', { name: 'Do not enter the water' })).toBeVisible();
  await expect(aside.getByText(prohibitionNotice(PROHIBITED).text)).toBeVisible();
  await expect(aside.locator('figure[role=img]')).toHaveCount(0);
});
