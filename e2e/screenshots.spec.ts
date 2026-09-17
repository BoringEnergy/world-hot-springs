/**
 * Pictures for a human, attached to the report. Nothing here compares pixels:
 * no web font is loaded, so text falls back to whatever the OS has, and
 * SwiftShader's output differs between Windows and Linux. A pixel baseline
 * would fail on the first CI run for reasons nobody meant to test.
 *
 * Each shot first asserts that its subject is on screen, so a shot of the
 * wrong thing fails rather than attaching quietly.
 *
 *   mutation: WelcomePanel removed from App -- the welcome shots fail
 *
 * The clock is fixed (setFixedTime, which leaves timers running so the map
 * still animates and settles) because the spring card's scene is lit by the
 * sun's position at the spring right now.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './support/offline.ts';
import { waitForIdle, waitForMap } from './support/map.ts';
import { record } from './support/records.ts';
import { tabLabel } from './support/source.ts';
import { href } from '../src/lib/router.ts';

const RADIUM = record('radium');
const NOON_UTC = new Date('2026-09-16T12:00:00Z');

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 900 },
];

async function shoot(page: Page, name: string, subject: Locator) {
  await expect(subject).toBeVisible();
  await waitForIdle(page);
  await test.info().attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

async function open(page: Page, width: number, height: number, path: string) {
  await page.clock.setFixedTime(NOON_UTC);
  await page.setViewportSize({ width, height });
  await page.goto(path);
  await waitForMap(page);
}

for (const v of VIEWPORTS) {
  test.describe(`${v.name} ${v.width}x${v.height}`, () => {
    test.describe('first visit', () => {
      test.use({ seedStorage: false });

      test('the welcome panel', async ({ page }) => {
        await open(page, v.width, v.height, '/');
        await shoot(page, `welcome-${v.name}`, page.getByRole('button', { name: 'Open the map', exact: true }));
      });
    });

    test('the map', async ({ page }) => {
      await open(page, v.width, v.height, '/');
      await shoot(page, `map-${v.name}`, page.getByRole('application', { name: 'Map of hot springs' }));
    });

    test('a spring card', async ({ page }) => {
      await open(page, v.width, v.height, href({ kind: 'spring', id: RADIUM.id }));
      await shoot(page, `card-${v.name}`, page.getByRole('complementary', { name: `Details for ${RADIUM.name}` }));
    });

    test('the safety page', async ({ page }) => {
      await open(page, v.width, v.height, href({ kind: 'page', page: 'safety' }));
      await shoot(page, `safety-${v.name}`, page.getByRole('dialog').getByRole('heading', { name: tabLabel('safety') }));
    });
  });
}
