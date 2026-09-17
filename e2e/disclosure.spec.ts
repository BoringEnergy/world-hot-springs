/**
 * The privacy page tells the truth about what the browser does.
 *
 * Checked against a journey that reaches every kind of request the app
 * makes: a cold load, a spring card (the weather reading, and with reduced
 * motion a jump to zoom 12, so imagery and terrain), then a cold deep link to
 * a second spring at zoom 12. B0 measured this journey contacting 9 hosts
 * (e2e/README.md, "Hosts contacted").
 *
 *   every contacted host is listed   mutation: the open-meteo entry deleted
 *                                    from THIRD_PARTIES
 *   every listed host is contacted   mutation: a bogus host added to it
 *   nothing else is stored           mutation: main.tsx writes sessionStorage
 *
 * Pinned defect (the fix flips it):
 *
 *   D5  the privacy page does not name the welcome panel's storage key, and
 *       says the unit preference is the only thing the site stores
 */
import type { Page } from '@playwright/test';
import { test, expect, type Offline } from './support/offline.ts';
import { waitForData, waitForIdle, waitForMap } from './support/map.ts';
import { record } from './support/records.ts';
import { UNITS_KEY, WELCOMED_KEY } from './support/source.ts';
import { href } from '../src/lib/router.ts';

const RADIUM = record('radium');
const PROHIBITED = record('prohibited');

test.use({ viewport: { width: 1440, height: 900 } });

async function journey(page: Page, net: Offline) {
  await page.goto('/');
  await waitForMap(page);
  await waitForData(page);
  await waitForIdle(page);

  await page.getByRole('textbox', { name: 'Search hot springs' }).fill(RADIUM.name!);
  await page.getByRole('main').getByRole('button', { name: new RegExp(`^${RADIUM.name}`) }).first().click();
  await expect(page).toHaveURL(href({ kind: 'spring', id: RADIUM.id }));
  await expect.poll(() => net.counts.weather, { message: 'the card never asked for the weather' }).toBeGreaterThan(0);
  await expect.poll(() => net.counts.imagery, { message: 'zoom 12 never asked for imagery' }).toBeGreaterThan(0);
  await expect.poll(() => net.counts.terrain, { message: 'zoom 12 never asked for terrain' }).toBeGreaterThan(0);
  await waitForIdle(page);

  await page.goto(href({ kind: 'spring', id: PROHIBITED.id }));
  await waitForMap(page);
  await page.waitForFunction(() => (window.__map?.getZoom() ?? 0) >= 12);
  await waitForIdle(page);
}

/** The hosts the rendered privacy page lists. */
async function listedHosts(page: Page): Promise<string[]> {
  await page.goto(href({ kind: 'page', page: 'privacy' }));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const codes = await dialog.locator('code').allTextContents();
  // The same page also sets `c` and `f` in code type; a host has a dot.
  const hosts = codes.map((c) => c.trim()).filter((c) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(c));
  expect(hosts.length, 'the privacy page lists no hosts at all').toBeGreaterThan(0);
  return hosts;
}

/** `tiles-a.basemaps.cartocdn.com` is covered by `basemaps.cartocdn.com`, at a dot. */
const covers = (listed: string, host: string) => host === listed || host.endsWith(`.${listed}`);

test('every host the journey contacted is listed on the privacy page', async ({ page, net }) => {
  await journey(page, net);
  const contacted = [...net.hosts].sort();
  expect(net.unrouted, 'requests the harness did not recognise').toEqual([]);
  const listed = await listedHosts(page);
  const undisclosed = contacted.filter((h) => !listed.some((l) => covers(l, h)));
  expect(undisclosed, `contacted ${contacted.join(', ')}; listed ${listed.join(', ')}`).toEqual([]);
});

test('every host the privacy page lists was contacted by the journey', async ({ page, net }) => {
  await journey(page, net);
  const contacted = [...net.hosts];
  const listed = await listedHosts(page);
  const neverContacted = listed.filter((l) => !contacted.some((h) => covers(l, h)));
  expect(neverContacted, `listed ${listed.join(', ')}; contacted ${contacted.join(', ')}`).toEqual([]);
});

test('the journey leaves nothing in the browser but the two preference keys', async ({ page, context, net }) => {
  await journey(page, net);
  const stored = await page.evaluate(async () => ({
    local: Object.keys(localStorage).sort(),
    session: Object.keys(sessionStorage),
    cookie: document.cookie,
    indexedDB: (await indexedDB.databases()).map((d) => d.name),
    caches: await caches.keys(),
  }));
  expect(stored).toEqual({
    local: [UNITS_KEY, WELCOMED_KEY].sort(),
    session: [],
    cookie: '',
    indexedDB: [],
    caches: [],
  });
  expect(await context.cookies()).toEqual([]);
});

test.describe('a first visit', () => {
  test.use({ seedStorage: false });

  test('known defect D5: the privacy page does not name the welcome key the site writes', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open the map', exact: true }).click();
    expect(await page.evaluate((k) => localStorage.getItem(k), WELCOMED_KEY), 'the site wrote the key').not.toBeNull();

    await page.goto(href({ kind: 'page', page: 'privacy' }));
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog, 'the privacy page names the welcome key').not.toContainText(WELCOMED_KEY);
    // And claims the unit letter is all there is.
    await expect(dialog).toContainText('the only thing this site writes');
  });
});
