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
 *   every key written is named,      mutations: the welcome entry deleted from
 *   every key named is written       STORAGE_KEYS; a key added to it that
 *                                    nothing writes (D5)
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
  // The storage keys have dots too, and live in their own list.
  const codes = await dialog
    .locator('code')
    .evaluateAll((els, list) => els.filter((e) => !e.closest(`ul[aria-label="${list}"]`)).map((e) => e.textContent ?? ''), STORED_LIST);
  const hosts = codes.map((c) => c.trim()).filter((c) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(c));
  expect(hosts.length, 'the privacy page lists no hosts at all').toBeGreaterThan(0);
  return hosts;
}

/** The privacy page's list of what it keeps on the device, by its accessible name. */
const STORED_LIST = 'Stored on your device';

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

  test('every key the site writes is named on the privacy page, and every key named is one it writes', async ({ page }) => {
    // Both writes a visitor can cause: dismissing the greeting, switching units.
    await page.goto('/');
    await page.getByRole('button', { name: 'Open the map', exact: true }).click();
    await page.getByRole('banner').getByRole('button', { name: /^Switch to / }).click();
    const written = await page.evaluate(() => Object.keys(localStorage).sort());
    expect(written, 'the visit wrote nothing, so there is nothing to check').not.toEqual([]);

    await page.goto(href({ kind: 'page', page: 'privacy' }));
    const list = page.getByRole('dialog').getByRole('list', { name: STORED_LIST });
    await expect(list).toBeVisible();
    const named = (await list.locator('code').allTextContents()).map((c) => c.trim()).sort();

    const unnamed = written.filter((k) => !named.includes(k));
    expect(unnamed, `written ${written.join(', ')}; named ${named.join(', ')}`).toEqual([]);
    const neverWritten = named.filter((k) => !written.includes(k));
    expect(neverWritten, `named ${named.join(', ')}; written ${written.join(', ')}`).toEqual([]);
  });
});
