/**
 * Offline reverse-geocoding to country level.
 *
 * OSM almost never tags addr:country on a spring, so country has to come from
 * the geometry. We do point-in-polygon against Natural Earth admin-0 (50m),
 * which is accurate enough for country attribution and small enough to cache.
 *
 * Coastal and small-island points can land just outside every polygon at 50m
 * resolution. Rather than dropping them to "Unknown", we fall back to the
 * nearest polygon within a tolerance — a spring 400m off the digitised
 * coastline of Iceland is in Iceland, and saying so is not inventing data.
 *
 * That fallback must measure distance to the POLYGON, never to the country's
 * bounding box. A country whose territory crosses the antimeridian has a bbox
 * spanning the globe: the United States runs lng -178.2 to 179.8 and lat 19.0
 * to 71.4 because of the Aleutians, and Russia and Fiji are the same. Ranking
 * by bbox made the US zero distance from every northern coastal point on
 * Earth, and it published 195 springs — in Iceland, Italy, Algeria, China and
 * the Canaries — as American. Polygons are indexed individually below so each
 * carries a tight bbox of its own, which is both the correctness fix and
 * faster than scanning a whole country's geometry.
 */
import fs from 'node:fs';
import path from 'node:path';

const CACHE = path.join('data', 'raw', 'ne_50m_admin_0_countries.geojson');
const SOURCE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';

/** Degrees. ~55km at the equator; generous enough for coastline digitisation error. */
const NEAREST_TOLERANCE_DEG = 0.5;

let index = null;

async function load() {
  if (!fs.existsSync(CACHE)) {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    process.stdout.write('  downloading Natural Earth admin-0 boundaries ... ');
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`country boundary download failed: HTTP ${res.status}`);
    fs.writeFileSync(CACHE, Buffer.from(await res.arrayBuffer()));
    console.log('done');
  }
  const geo = JSON.parse(fs.readFileSync(CACHE, 'utf8'));

  // One entry per POLYGON, not per country. Alaska's Aleutian islands then get
  // their own tight boxes instead of stretching the American one across the
  // antimeridian and over every other country in the northern hemisphere.
  index = geo.features.flatMap((f) => {
    const p = f.properties;
    // Natural Earth's casing has changed across releases; accept either.
    const iso =
      p.ISO_A2_EH || p.ISO_A2 || p.iso_a2_eh || p.iso_a2 || p.WB_A2 || p.wb_a2 || 'XX';
    const name = p.NAME_EN || p.NAME || p.name_en || p.name || 'Unknown';
    const geom = f.geometry;
    if (!geom) return [];
    const polys =
      geom.type === 'Polygon'
        ? [geom.coordinates]
        : geom.type === 'MultiPolygon'
          ? geom.coordinates
          : [];
    return polys.map((poly) => ({
      iso: iso === '-99' ? 'XX' : iso,
      name,
      poly,
      bbox: polygonBbox(poly),
    }));
  });
}

function polygonBbox(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  // The outer ring bounds the polygon; holes are inside it by definition.
  for (const [x, y] of poly[0]) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Ray casting. `ring` is a closed linear ring of [lon, lat]. */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A polygon is [outerRing, ...holes]. */
function pointInPolygon(x, y, polygon) {
  if (!pointInRing(x, y, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(x, y, polygon[i])) return false; // in a hole
  }
  return true;
}

function bboxDistance(x, y, [minX, minY, maxX, maxY]) {
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
  return Math.hypot(dx, dy);
}

/** Distance from a point to a line segment, in degrees. */
function segmentDistance(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  // A degenerate segment is a point. Guard the division rather than return NaN,
  // which compares false against every bound and would silently drop the
  // candidate instead of failing.
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/**
 * Distance from a point outside a polygon to its boundary. Only the outer ring
 * is measured: the exact pass has already rejected anything inside, and a point
 * in a hole is not what this fallback exists for.
 */
function polygonDistance(x, y, poly) {
  const ring = poly[0];
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const d = segmentDistance(x, y, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
    if (d < best) best = d;
  }
  return best;
}

export async function countryLookup() {
  if (!index) await load();
  return function lookup(lat, lng) {
    for (const c of index) {
      if (bboxDistance(lng, lat, c.bbox) > 0) continue;
      if (pointInPolygon(lng, lat, c.poly)) return { iso: c.iso, name: c.name, exact: true };
    }
    // Nearest-polygon fallback for coastal/island points. The bbox is a cheap
    // filter only; the ranking is true distance to the boundary, because a
    // bbox can be arbitrarily larger than the land inside it.
    let best = null;
    let bestDist = NEAREST_TOLERANCE_DEG;
    for (const c of index) {
      if (bboxDistance(lng, lat, c.bbox) >= bestDist) continue;
      const d = polygonDistance(lng, lat, c.poly);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (best) return { iso: best.iso, name: best.name, exact: false };
    return { iso: 'XX', name: 'Unknown', exact: false };
  };
}
