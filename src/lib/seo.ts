/**
 * What a crawler, a link unfurler and a citation manager see.
 *
 * This app renders client-side, so every one of those readers arrives at the
 * same <head> unless something rewrites it. Until this file existed, seven
 * thousand springs shared one title, one description and one canonical URL —
 * the machine-readable equivalent of the whole atlas being a single page.
 *
 * Two structured-data payloads, doing different jobs:
 *
 *  - `Dataset` on the root. This is the one that matters for a project that
 *    wants to be cited: Google Dataset Search reads schema.org/Dataset, and
 *    `distribution`, `license` and `creator` are what make an atlas indexable
 *    *as data* rather than as a travel page.
 *  - `TouristAttraction` on a record. A hot spring is a place; the temperature
 *    goes in `additionalProperty` rather than being smuggled into the name,
 *    and an unmeasured spring emits no temperature property at all — the same
 *    rule the cards follow, applied to the markup nobody reads.
 *
 * Nothing here ever invents a value. A field the record does not know is
 * omitted from the markup, because a structured-data consumer treats a
 * present-but-empty property as an assertion.
 */
import type { DatasetMeta, HotSpring } from './types';
import { absoluteHref, href, type PageName } from './router.ts';

const SITE_NAME = 'World Hot Springs';
const DEFAULT_TITLE = 'World Hot Springs — an open atlas';
const DEFAULT_DESCRIPTION =
  "An open, curated atlas of the world's public hot springs. Temperature, price, " +
  "clothing policy and hours — clearly labelled, including when we don't know.";

/** Upsert a <meta> by name or property. Never creates a duplicate. */
function meta(key: 'name' | 'property', value: string, content: string | null): void {
  const selector = `meta[${key}="${value}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (content === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(key, value);
    document.head.appendChild(el);
  }
  el.content = content;
}

function canonical(url: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = url;
}

/**
 * One <script type="application/ld+json"> per slot, replaced wholesale.
 * Slots are `id`-keyed so the record payload can come and go without ever
 * touching the dataset payload, and so a stale card's markup can never be
 * left behind on the map view.
 */
function jsonLd(slot: string, payload: object | null): void {
  const id = `ld-${slot}`;
  document.getElementById(id)?.remove();
  if (!payload) return;
  const el = document.createElement('script');
  el.id = id;
  el.type = 'application/ld+json';
  el.textContent = JSON.stringify(payload);
  document.head.appendChild(el);
}

function head(title: string, description: string, url: string): void {
  document.title = title;
  meta('name', 'description', description);
  canonical(url);
  meta('property', 'og:site_name', SITE_NAME);
  meta('property', 'og:type', 'website');
  meta('property', 'og:title', title);
  meta('property', 'og:description', description);
  meta('property', 'og:url', url);
  meta('name', 'twitter:card', 'summary');
  meta('name', 'twitter:title', title);
  meta('name', 'twitter:description', description);
}

/**
 * The record's own sentence, built from what is known and silent about what
 * is not. "Unknown" belongs on the card, where a human reads it as candour;
 * in a meta description it is noise that makes every unmeasured spring's
 * snippet identical.
 */
export function springDescription(spring: HotSpring): string {
  const where = [spring.location.nearestTown, spring.location.region, spring.location.countryName]
    .filter(Boolean)
    .join(', ');

  const facts: string[] = [];
  if (spring.temperature.celsius !== null) {
    facts.push(`${spring.temperature.celsius} °C (${spring.temperature.fahrenheit} °F)`);
  } else if (spring.temperature.qualitative) {
    facts.push(`described as ${spring.temperature.qualitative}, never measured`);
  } else {
    facts.push('no recorded temperature');
  }
  if (spring.access.price) facts.push(spring.access.price.toLowerCase() === 'free' ? 'free' : spring.access.price);
  if (spring.access.bathingAllowed === false) facts.push('bathing prohibited');

  const name = spring.name ?? 'Unnamed hot spring';
  return `${name}${where ? ` — ${where}` : ''}. ${facts.join(' · ')}. Sources and provenance on the record.`;
}

export function applySpringMeta(spring: HotSpring): void {
  const name = spring.name ?? 'Unnamed hot spring';
  const where = [spring.location.nearestTown, spring.location.countryName].filter(Boolean).join(', ');
  const url = absoluteHref({ kind: 'spring', id: spring.id });

  head(`${name}${where ? `, ${where}` : ''} — ${SITE_NAME}`, springDescription(spring), url);
  meta('property', 'og:type', 'place');
  meta('property', 'place:location:latitude', String(spring.location.lat));
  meta('property', 'place:location:longitude', String(spring.location.lng));

  const properties: object[] = [];
  if (spring.temperature.celsius !== null) {
    properties.push({
      '@type': 'PropertyValue',
      name: 'Water temperature',
      value: spring.temperature.celsius,
      unitCode: 'CEL',
      ...(spring.temperature.measuredAt ? { valueReference: `measured ${spring.temperature.measuredAt}` } : {}),
    });
  }
  if (spring.access.bathingAllowed === false) {
    properties.push({ '@type': 'PropertyValue', name: 'Bathing permitted', value: 'No' });
  }

  jsonLd('record', {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    '@id': url,
    url,
    name,
    ...(spring.description ? { description: spring.description } : {}),
    geo: {
      '@type': 'GeoCoordinates',
      latitude: spring.location.lat,
      longitude: spring.location.lng,
      ...(spring.location.elevation !== null ? { elevation: spring.location.elevation } : {}),
    },
    address: {
      '@type': 'PostalAddress',
      ...(spring.location.nearestTown ? { addressLocality: spring.location.nearestTown } : {}),
      ...(spring.location.region ? { addressRegion: spring.location.region } : {}),
      ...(spring.location.country && spring.location.country !== 'XX'
        ? { addressCountry: spring.location.country }
        : {}),
    },
    ...(properties.length ? { additionalProperty: properties } : {}),
    ...(spring.sources.length ? { subjectOf: spring.sources.map((url) => ({ '@type': 'CreativeWork', url })) } : {}),
    isAccessibleForFree: spring.access.price?.toLowerCase() === 'free' ? true : undefined,
  });
}

export interface DatasetFacts {
  total: number;
  countries: number;
  sourceDate: string;
}

/**
 * The root page, and the payload that gets this atlas into Google Dataset
 * Search. Rendered from the dataset's own metadata rather than from constants
 * here, for the reason the About panel is: a hand-typed licence line is a
 * licence line that goes stale, and this one is a public claim about terms.
 */
export function applyDefaultMeta(datasetMeta: DatasetMeta | null, facts: DatasetFacts | null): void {
  head(DEFAULT_TITLE, DEFAULT_DESCRIPTION, absoluteHref({ kind: 'map' }));
  jsonLd('record', null);

  jsonLd('dataset', {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'World Hot Springs',
    description:
      'An open, curated, provenance-attached atlas of the world’s public and semi-public hot ' +
      'springs. Temperature, price, clothing policy and opening hours are first-class fields; ' +
      'unknown values are stored explicitly as null rather than omitted or invented.',
    url: absoluteHref({ kind: 'map' }),
    ...(facts
      ? {
          measurementTechnique: 'Normalisation and deduplication of public geospatial and geothermal sources',
          temporalCoverage: `../${facts.sourceDate.slice(0, 10)}`,
          variableMeasured: ['location', 'water temperature', 'price', 'clothing policy', 'opening hours'],
        }
      : {}),
    ...(datasetMeta
      ? {
          license: datasetMeta.licenseUrl,
          creditText: datasetMeta.attribution,
          isBasedOn: datasetMeta.sources.map((s) => ({
            '@type': 'Dataset',
            name: s.name,
            url: s.url,
            creditText: s.attribution,
          })),
        }
      : {}),
    creator: { '@type': 'Organization', name: 'World Hot Springs contributors' },
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/geo+json',
        contentUrl: new URL(
          `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}data/hot-springs.geojson`,
          window.location.origin,
        ).toString(),
      },
    ],
  });
}

const PAGE_META: Record<PageName, { title: string; description: string }> = {
  about: { title: 'About', description: 'What this atlas is, what it leaves out, and why.' },
  terms: { title: 'Terms of use', description: 'The terms that govern use of this atlas and its dataset.' },
  privacy: { title: 'Privacy', description: 'What this site collects, what it does not, and which third parties your browser contacts.' },
  safety: { title: 'Safety', description: 'Geothermal water scalds. What this atlas is and is not a substitute for.' },
};

export function applyPageMeta(page: PageName): void {
  const { title, description } = PAGE_META[page];
  head(`${title} — ${SITE_NAME}`, description, absoluteHref({ kind: 'page', page }));
  jsonLd('record', null);
}

export { href };
