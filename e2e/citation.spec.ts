/**
 * The atlas says how to cite it, in the markup and on the page.
 *
 *   the Dataset JSON-LD carries the DOI   mutations: `identifier` removed;
 *                                         `temporalCoverage` put back;
 *                                         `version` added
 *   the About panel links the DOI         mutation: the link's href wrong
 *   the Terms page names the archive      mutation: the caveat paragraph removed
 *   the DOI link wraps on a phone         mutation: `wrap-anywhere` removed
 *
 * The DOI, the citation and the creator are read from src/lib/citation.ts,
 * and the licence from the dataset the page loads, so nothing here is a
 * second copy of them.
 *
 * The About panel links doi.org with a plain anchor and shows no badge. A
 * badge is an image from zenodo.org, a host the privacy page does not list,
 * so opening the panel must contact neither host. disclosure.spec.ts holds
 * the rest of the journey to the privacy page; this spec holds the panel.
 */
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './support/offline.ts';
import { waitForData, waitForMap } from './support/map.ts';
import { href } from '../src/lib/router.ts';
import { CREATORS, DOI_URL, RECOMMENDED_CITATION } from '../src/lib/citation.ts';

const META = JSON.parse(fs.readFileSync('data/hot-springs.geojson', 'utf8')).metadata as { licenseUrl: string };

test.use({ viewport: { width: 1440, height: 900 } });

async function datasetLd(page: Page): Promise<Record<string, unknown>> {
  const text = await page.locator('script#ld-dataset').textContent();
  expect(text, 'no Dataset JSON-LD on the map view').toBeTruthy();
  return JSON.parse(text!) as Record<string, unknown>;
}

test('the Dataset JSON-LD names the DOI, the licence and the publisher', async ({ page }) => {
  await page.goto('/');
  await waitForMap(page);
  await waitForData(page);
  // Written again once the dataset's metadata has arrived; the licence is the
  // sign that this is that second write.
  await expect.poll(async () => (await datasetLd(page)).license, { message: 'the JSON-LD never gained a licence' })
    .toBe(META.licenseUrl);

  const ld = await datasetLd(page);
  expect(ld['@type']).toBe('Dataset');
  expect(ld.identifier, 'the JSON-LD does not identify the dataset by its DOI').toBe(DOI_URL);
  expect(ld.sameAs, 'the JSON-LD does not say the DOI page is the same dataset').toBe(DOI_URL);
  expect(META.licenseUrl).toMatch(/^https:\/\//);
  expect(ld.creator).toEqual(CREATORS.map((c) => ({ '@type': 'Organization', name: c.name })));
  expect(CREATORS.map((c) => c.name)).toContain('Hudson R&D');
  // The OSM fetch date is the age of one layer, not of the atlas.
  expect(ld, 'the JSON-LD dates the atlas by its OpenStreetMap layer').not.toHaveProperty('temporalCoverage');
  // schema.org `citation` is what the dataset cites, not how to cite it.
  expect(ld).not.toHaveProperty('citation');
  // The site deploys main, which is usually ahead of the last release, so it
  // cannot say which version it is showing.
  expect(ld, 'the live site claims a dataset version').not.toHaveProperty('version');
});

test('the Terms page says what removal cannot reach', async ({ page }) => {
  // The same caveat PRIVACY.md's "Archived versions" makes (docs.test.mjs
  // holds that file). A Terms page that promised permanent removal while the
  // project archives immutable versions would be a promise it cannot keep.
  await page.goto(href({ kind: 'page', page: 'terms' }));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (const phrase of [
    /archived on Zenodo under a DOI/,
    /archived\s+version cannot be altered/,
    /to the repository from that point on, and to every later version/,
    /ask Zenodo to restrict access/,
    /handled before any release/,
  ]) {
    await expect(dialog, `the Terms page no longer says ${phrase}`).toContainText(phrase);
  }
});

test('the DOI link wraps rather than widening a phone-sized About panel', async ({ page }) => {
  // Measured 2026-09-17: at 320 px the link fits with 11 px to spare in
  // Segoe UI and overflows by 32 px in Verdana, a stand-in for the wider
  // fonts a Linux phone or runner may pick -- no web font loads. So the
  // assertion is containment, which holds under any font once the link wraps.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(href({ kind: 'page', page: 'about' }));
  const dialog = page.getByRole('dialog');
  const link = dialog.getByRole('link', { name: DOI_URL, exact: true });
  await expect(link).toBeVisible();
  // A long unbreakable run is the case that matters; force the widest
  // plausible metrics so a missing wrap cannot hide behind a narrow font.
  await page.addStyleTag({ content: '[role="dialog"] { font-family: Verdana, "DejaVu Sans", sans-serif !important; }' });
  const fits = await link.evaluate((a) => {
    const box = a.getBoundingClientRect();
    const para = a.parentElement!.getBoundingClientRect();
    return { right: box.right, limit: para.right, overflow: a.closest('[role="dialog"]')!.scrollWidth - a.closest('[role="dialog"]')!.clientWidth };
  });
  expect(fits.right, 'the DOI link runs past its paragraph').toBeLessThanOrEqual(fits.limit + 0.5);
  expect(fits.overflow, 'the About panel scrolls sideways').toBeLessThanOrEqual(0);
});

test('the About panel links the DOI and gives the citation, without contacting either host', async ({ page, net }) => {
  await page.goto(href({ kind: 'page', page: 'about' }));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Cite this dataset' })).toBeVisible();

  const link = dialog.getByRole('link', { name: DOI_URL, exact: true });
  await expect(link).toHaveAttribute('href', DOI_URL);
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(dialog.getByText(RECOMMENDED_CITATION, { exact: true })).toBeVisible();
  await expect(dialog).toContainText('each one has its own DOI');

  await waitForData(page);
  const hosts = [...net.hosts];
  for (const archive of [new URL(DOI_URL).host, 'zenodo.org']) {
    expect(
      hosts.filter((h) => h === archive || h.endsWith(`.${archive}`)),
      `opening the About panel contacted ${archive}`,
    ).toEqual([]);
  }
  expect(net.unrouted, 'requests the harness did not recognise').toEqual([]);
});
