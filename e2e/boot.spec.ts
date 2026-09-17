/**
 * A cold load of `/` produces a working atlas.
 *
 *   the page boots clean     mutations: throw in Header; a 404 for the style
 *   every spring is loaded   mutation: `springs.slice(1)` in the store
 */
import fs from 'node:fs';
import { test, expect } from './support/offline.ts';
import { springsInSource } from './support/map.ts';
import { DEFAULT_TITLE } from './support/source.ts';

/**
 * Console errors a clean boot is allowed to print. Empty: a cold load at
 * 1280x720 printed none on 2026-09-16. An entry here needs a reason beside it.
 */
const ALLOWED_CONSOLE_ERRORS: RegExp[] = [];

const SUMMARY = JSON.parse(fs.readFileSync('data/summary.json', 'utf8')) as { total: number };

test('a cold load renders the page and boots the map without an error', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ALLOWED_CONSOLE_ERRORS.some((re) => re.test(m.text()))) consoleErrors.push(m.text());
  });

  await page.goto('/');

  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();

  /*
   * The map either finishes setting up or reports why it could not. MapView
   * listens for MapLibre's `error` event, and once any listener exists
   * MapLibre stops logging to the console -- so a failed style is invisible
   * to the console check below and has to be read from data-map-error.
   */
  await page.waitForFunction(
    () => !!window.__map?.getSource('springs') || !!document.documentElement.dataset.mapError,
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.mapReady === 'true' || !!document.documentElement.dataset.mapError,
  );
  const mapError = await page.evaluate(() => document.documentElement.dataset.mapError ?? null);
  expect(mapError, 'MapLibre reported an error').toBeNull();

  expect(pageErrors, 'uncaught exceptions').toEqual([]);
  expect(consoleErrors, 'console errors outside ALLOWED_CONSOLE_ERRORS').toEqual([]);
  await expect(page).toHaveTitle(DEFAULT_TITLE);
});

test('the springs source holds every record in the dataset', async ({ page }) => {
  await page.goto('/');
  // data/summary.json is what the build counted. Default filters hide
  // nothing, so the map must carry all of it.
  await expect
    .poll(() => springsInSource(page), { message: `the map should hold all ${SUMMARY.total} springs`, timeout: 15_000 })
    .toBe(SUMMARY.total);
});
