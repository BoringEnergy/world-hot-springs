/**
 * One URL per record, plus the standing pages.
 *
 * A sitemap is the difference between "the springs have addresses" and "the
 * addresses are known to exist". Nothing on the map links to a record until a
 * human clicks a pin, so a crawler starting at the root discovers exactly one
 * page and leaves. Every permalink built in lib/router.ts is unreachable
 * without this file.
 *
 * `lastmod` is the record's own lastVerified, not the build date. Stamping
 * today's date on 7,490 unchanged records is the sitemap equivalent of
 * inventing a temperature: it tells a crawler the whole atlas changed when
 * nothing did, and it is the fastest way to be ignored.
 *
 *   node scripts/build-sitemap.mjs [--origin https://example.org]
 */
import fs from 'node:fs';
import path from 'node:path';
// `file://${process.argv[1]}` is not this module's URL on Windows: argv[1] is a
// backslashed drive path and import.meta.url is `file:///C:/...`. The guard
// silently never fired, so `npm run build` skipped this script on Windows and
// only ever regenerated the output on the Linux build host.
import { pathToFileURL } from 'node:url';

const DEFAULT_ORIGIN = 'https://whs.boring.energy';
const PAGES = ['about', 'safety', 'terms', 'privacy'];
const OUT = path.join('public', 'sitemap.xml');
const GEOJSON = path.join('data', 'hot-springs.geojson');

/** Sitemaps cap at 50,000 URLs. We are far under; assert rather than assume. */
const MAX_URLS = 50_000;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** ISO date or nothing. A malformed lastmod invalidates the whole entry. */
function lastmod(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

export function buildSitemap(features, origin = DEFAULT_ORIGIN) {
  const urls = [
    { loc: `${origin}/`, priority: '1.0', changefreq: 'weekly' },
    ...PAGES.map((p) => ({ loc: `${origin}/${p}`, priority: '0.3', changefreq: 'yearly' })),
  ];

  for (const f of features) {
    const p = f.properties;
    if (!p?.id) continue;
    urls.push({
      loc: `${origin}/s/${p.id}`,
      lastmod: lastmod(p.lastVerified),
      // Records we actually know something about are the ones worth indexing
      // first. Completeness is already computed; reusing it here beats a
      // made-up constant on every row.
      priority: (0.3 + Math.min(1, (p.quality?.completeness ?? 0) / 100) * 0.5).toFixed(2),
      changefreq: 'monthly',
    });
  }

  if (urls.length > MAX_URLS) {
    throw new Error(`${urls.length} URLs exceeds the ${MAX_URLS} single-file sitemap limit; split into an index`);
  }

  const body = urls
    .map(
      (u) =>
        '  <url>\n' +
        `    <loc>${esc(u.loc)}</loc>\n` +
        (u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : '') +
        (u.changefreq ? `    <changefreq>${u.changefreq}</changefreq>\n` : '') +
        (u.priority ? `    <priority>${u.priority}</priority>\n` : '') +
        '  </url>',
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = arg('origin', DEFAULT_ORIGIN).replace(/\/+$/, '');
  const geo = JSON.parse(fs.readFileSync(GEOJSON, 'utf8'));
  const xml = buildSitemap(geo.features, origin);
  fs.writeFileSync(OUT, xml);
  console.log(`${OUT}: ${(xml.match(/<url>/g) ?? []).length} URLs at ${origin}`);
}
