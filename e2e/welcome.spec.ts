/**
 * The welcome panel: shown to a first visit, once, and gone for good after
 * any way out of it.
 *
 *   shown once                  mutation: markSeen() does nothing
 *   every exit dismisses it     mutation: dismiss() removed from Show me one
 *   never over a cold deep link mutation: the panel's initial state ignores
 *                               the arrival address (the D3 fix reverted)
 *   a closed deep-linked card   the same mutation (D3b)
 *   does not bring it up
 *   a search / Near me closes   mutation: the effect that dismisses the
 *   it, marked seen             panel on a search or Near me removed (D4)
 *   Escape meant for a page     mutation: the Escape listener keyed on `open`
 *   leaves it unseen            instead of on-screen (the D8 fix reverted)
 *
 * No seeding here: every test starts as a first visit.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './support/offline.ts';
import { waitForData } from './support/map.ts';
import { record } from './support/records.ts';
import { tabLabel, WELCOMED_KEY } from './support/source.ts';
import { href } from '../src/lib/router.ts';

test.use({ seedStorage: false });

const RADIUM = record('radium');

/*
 * The panel has no landmark or role of its own, so it is found by its first
 * action, the one button on the page with this name.
 */
const openTheMap = (page: Page) => page.getByRole('button', { name: 'Open the map', exact: true });
const welcomed = (page: Page) => page.evaluate((k) => localStorage.getItem(k), WELCOMED_KEY);
const card = (page: Page) => page.getByRole('complementary', { name: /^Details for / });

test('the welcome panel is shown to a first visit, and only once', async ({ page }) => {
  await page.goto('/');
  await expect(openTheMap(page)).toBeVisible();
  expect(await welcomed(page), 'nothing is stored before the visitor acts').toBeNull();

  await openTheMap(page).click();
  await expect(openTheMap(page)).toBeHidden();

  await page.reload();
  // The panel renders on mount or not at all, and the dataset arriving is
  // the last thing that could change its mind (a route applied on load).
  await waitForData(page);
  await expect(openTheMap(page)).toBeHidden();
});

const EXITS: { name: string; act: (page: Page) => Promise<void>; after?: (page: Page) => Promise<void> }[] = [
  { name: 'Open the map', act: (page) => openTheMap(page).click() },
  { name: 'Close', act: (page) => page.getByRole('button', { name: 'Close', exact: true }).click() },
  { name: 'Escape', act: (page) => page.keyboard.press('Escape') },
  {
    name: 'Show me one',
    act: async (page) => {
      // Disabled until the dataset is in; it picks from the loaded records.
      await expect(page.getByRole('button', { name: 'Show me one' })).toBeEnabled();
      await page.getByRole('button', { name: 'Show me one' }).click();
    },
    after: async (page) => {
      await expect(card(page)).toBeVisible();
      await expect(page).toHaveURL(/\/s\/whs_[0-9a-f]{12}$/);
    },
  },
  {
    name: 'the safety link',
    act: (page) => page.getByRole('link', { name: /safety page/ }).click(),
    after: async (page) => {
      await expect(page).toHaveURL(href({ kind: 'page', page: 'safety' }));
      await expect(page.getByRole('dialog').getByRole('heading', { name: tabLabel('safety') })).toBeVisible();
    },
  },
];

for (const exit of EXITS) {
  test(`every exit dismisses the welcome panel for good: ${exit.name}`, async ({ page }) => {
    await page.goto('/');
    await expect(openTheMap(page)).toBeVisible();

    await exit.act(page);
    await exit.after?.(page);

    await expect(openTheMap(page)).toBeHidden();
    // Hidden is not enough: a card or a page also hides it. Seen is the claim.
    expect(await welcomed(page), `${exit.name} closed the panel without marking it seen`).toBe('1');
  });
}

/*
 * Records, from the first byte of the document, whether the greeting ever
 * rendered. "Hidden now" cannot tell a panel that never showed from one that
 * flashed up while the dataset was on its way.
 */
async function watchForGreeting(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __greeted?: boolean };
    new MutationObserver(() => {
      for (const b of document.querySelectorAll('button')) {
        if (b.textContent?.trim() === 'Open the map') w.__greeted = true;
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
const greeted = (page: Page) => page.evaluate(() => !!(window as unknown as { __greeted?: boolean }).__greeted);

test('a cold deep link never shows the welcome panel, even while the dataset is on its way', async ({ page, net }) => {
  await watchForGreeting(page);
  for (const path of [href({ kind: 'spring', id: RADIUM.id }), href({ kind: 'page', page: 'terms' })]) {
    const dataset = net.hold('dataset');
    await page.goto(path);
    await dataset.requested;
    // Held: the store has not applied the route yet and says "nothing asked
    // for". The panel decides from the address instead, so it stays away.
    await expect(page.getByRole('main')).toBeVisible();
    expect(await greeted(page), `${path}: the greeting was over the deep link while the dataset was held`).toBe(false);
    dataset.release();
    await waitForData(page);
    expect(await greeted(page), `${path}: the greeting appeared once the dataset arrived`).toBe(false);
  }
});

test('closing a deep-linked card does not bring up the welcome panel, and the panel waits for a visit to the map', async ({ page }) => {
  await watchForGreeting(page);
  await page.goto(href({ kind: 'spring', id: RADIUM.id }));
  await expect(card(page)).toBeVisible();

  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(card(page)).toBeHidden();
  await expect(page).toHaveURL(href({ kind: 'map' }));
  expect(await greeted(page), 'the greeting appeared after the visitor had already used the atlas').toBe(false);
  // Never seen, so never marked seen: the next arrival at the map gets it.
  expect(await welcomed(page), 'a panel the visitor never saw was marked seen').toBeNull();

  await page.goto(href({ kind: 'map' }));
  await expect(openTheMap(page)).toBeVisible();
});

/** Whether a click at the centre of `result` would land on it. */
async function hitTestable(result: Locator) {
  const box = (await result.boundingBox())!;
  return result.evaluate(
    (el, [x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && el.contains(hit);
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
}

test('a search closes the welcome panel, marks it seen, and leaves the results clickable', async ({ page }) => {
  await page.goto('/');
  await waitForData(page);
  await expect(openTheMap(page)).toBeVisible();

  await page.getByRole('textbox', { name: 'Search hot springs' }).fill(RADIUM.name!);
  const result = page.getByRole('main').getByRole('button', { name: new RegExp(RADIUM.name!) }).first();
  await expect(result).toBeVisible();
  await expect(openTheMap(page), 'the greeting is still up over the search').toBeHidden();
  expect(await welcomed(page), 'a search closed the greeting without marking it seen').toBe('1');
  expect(await hitTestable(result), 'the first search result is under the greeting').toBe(true);
});

test('Near me in the header closes the welcome panel, marks it seen, and leaves the results clickable', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  // Radium's own coordinates, so the nearest result is a known record.
  await context.setGeolocation({ latitude: RADIUM.location.lat, longitude: RADIUM.location.lng });
  await page.goto('/');
  await waitForData(page);
  await expect(openTheMap(page)).toBeVisible();

  await page.getByRole('banner').getByRole('button', { name: 'Find springs near me' }).click();
  const result = page.getByRole('main').getByRole('button', { name: new RegExp(RADIUM.name!) }).first();
  await expect(result).toBeVisible();
  await expect(openTheMap(page), 'the greeting is still up over the nearest springs').toBeHidden();
  expect(await welcomed(page), 'Near me closed the greeting without marking it seen').toBe('1');
  expect(await hitTestable(result), 'the nearest result is under the greeting').toBe(true);
});

test('opening the filters closes the welcome panel for good', async ({ page }) => {
  // Review of the harness fixes, 2026-09-17: the panel used to unmount while
  // the rail was open and re-read "not seen" when the rail shut, so a visitor
  // who had filtered and picked a spring met the greeting again on the way
  // back. Opening the filters is now an answer to it, like a search.
  await watchForGreeting(page);
  await page.goto('/');
  await waitForData(page);
  await expect(openTheMap(page)).toBeVisible();

  const filters = page.getByRole('banner').getByRole('button', { name: 'Filters' });
  await filters.click();
  await expect(openTheMap(page), 'the greeting is still up over the filter rail').toBeHidden();
  expect(await welcomed(page), 'opening the filters closed the greeting without marking it seen').toBe('1');

  // From here on the greeting must not render again, not even for a frame.
  await page.evaluate(() => { (window as unknown as { __greeted?: boolean }).__greeted = false; });
  await filters.click();
  await expect(filters).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('application', { name: 'Map of hot springs' }).click({ position: { x: 5, y: 5 } });
  expect(await greeted(page), 'the greeting came back once the filter rail shut').toBe(false);
});

test('Escape meant for a page covering the welcome panel leaves the panel unseen', async ({ page }) => {
  // Shown at the map, then covered by a standing page from the footer.
  await page.goto(href({ kind: 'map' }));
  await expect(openTheMap(page)).toBeVisible();
  await page.getByRole('contentinfo').locator(`a[href="${href({ kind: 'page', page: 'terms' })}"]`).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: tabLabel('terms') })).toBeVisible();
  await expect(openTheMap(page)).toBeHidden();

  // Escape closes the page, and only the page.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await welcomed(page), 'a panel hidden behind the page was marked seen').toBeNull();
  await expect(openTheMap(page), 'the greeting did not come back once the page closed').toBeVisible();

  // Once it is on screen again, Escape is its own.
  await page.keyboard.press('Escape');
  await expect(openTheMap(page)).toBeHidden();
  expect(await welcomed(page)).toBe('1');
});
