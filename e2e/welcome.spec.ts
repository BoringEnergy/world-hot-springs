/**
 * The welcome panel: shown to a first visit, once, and gone for good after
 * any way out of it.
 *
 *   shown once                  mutation: markSeen() does nothing
 *   every exit dismisses it     mutation: dismiss() removed from Show me one
 *
 * Pinned defects. Each asserts what the app does TODAY, so it fails when the
 * defect is fixed as surely as when the harness breaks; the fix flips it.
 *
 *   D3   shown over a cold deep link until the dataset arrives
 *   D3b  closing a deep-linked card reveals it
 *   D4   it covers the search results
 *   D8   Escape pressed while it is hidden marks it seen
 *
 * No seeding here: every test starts as a first visit.
 */
import type { Page } from '@playwright/test';
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

test('known defect D3: the welcome panel shows over a cold deep link until the dataset arrives', async ({ page, net }) => {
  for (const path of [href({ kind: 'spring', id: RADIUM.id }), href({ kind: 'page', page: 'terms' })]) {
    const dataset = net.hold('dataset');
    await page.goto(path);
    await dataset.requested;
    // The route is applied only once the records exist, so until then the
    // store says "nothing asked for" and the greeting takes the screen.
    await expect(openTheMap(page), `${path}: the greeting is over the deep link`).toBeVisible();
    dataset.release();
    await expect(openTheMap(page), `${path}: and gives way once the route applies`).toBeHidden();
  }
});

test('known defect D3b: closing a deep-linked card reveals the welcome panel', async ({ page }) => {
  await page.goto(href({ kind: 'spring', id: RADIUM.id }));
  await expect(card(page)).toBeVisible();
  await expect(openTheMap(page)).toBeHidden();

  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(card(page)).toBeHidden();
  await expect(openTheMap(page), 'the greeting appears after the visitor has already used the atlas').toBeVisible();
});

test('known defect D4: the welcome panel covers the search results', async ({ page }) => {
  await page.goto('/');
  await waitForData(page);
  await expect(openTheMap(page)).toBeVisible();

  await page.getByRole('textbox', { name: 'Search hot springs' }).fill(RADIUM.name!);
  const result = page.getByRole('main').getByRole('button', { name: new RegExp(RADIUM.name!) }).first();
  await expect(result).toBeAttached();

  // What a click at the centre of the first result would land on.
  const box = (await result.boundingBox())!;
  const hitsResult = await result.evaluate(
    (el, [x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && el.contains(hit);
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(hitsResult, 'the first search result is under the greeting').toBe(false);
});

test('known defect D8: Escape pressed while the welcome panel is hidden marks it seen', async ({ page }) => {
  await page.goto(href({ kind: 'spring', id: RADIUM.id }));
  await expect(card(page)).toBeVisible();
  // Hidden behind the card, never seen.
  await expect(openTheMap(page)).toBeHidden();
  expect(await welcomed(page)).toBeNull();

  // Escape is meant for the card. It closes it -- and dismisses the unseen panel.
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  expect(await welcomed(page), 'a panel the visitor never saw was marked seen').toBe('1');
  await expect(openTheMap(page)).toBeHidden();
});
