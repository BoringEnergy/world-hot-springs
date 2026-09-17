/**
 * The atlas says how to cite it, in the markup and on the page.
 *
 *   the Dataset JSON-LD carries the DOI   mutations: `identifier` removed;
 *                                         `temporalCoverage` put back
 *   the About panel links the DOI         mutation: the link's href wrong
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
