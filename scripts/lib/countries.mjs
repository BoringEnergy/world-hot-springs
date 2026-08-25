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

  index = geo.features.map((f) => {
    const p = f.properties;
    // Natural Earth's casing has changed across releases; accept either.
    const iso =
      p.ISO_A2_EH || p.ISO_A2 || p.iso_a2_eh || p.iso_a2 || p.WB_A2 || p.wb_a2 || 'XX';
    const name = p.NAME_EN || p.NAME || p.name_en || p.name || 'Unknown';
    const rings = [];
    const geom = f.geometry;
    if (!geom) return null;
    if (geom.type === 'Polygon') rings.push(geom.coordinates);
    else if (geom.type === 'MultiPolygon') rings.push(...geom.coordinates);
    const bbox = ringsBbox(rings);
    return { iso: iso === '-99' ? 'XX' : iso, name, rings, bbox };
  }).filter(Boolean);
}

function ringsBbox(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of rings) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
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

export async function countryLookup() {
  if (!index) await load();
  return function lookup(lat, lng) {
    for (const c of index) {
      if (bboxDistance(lng, lat, c.bbox) > 0) continue;
      for (const poly of c.rings) {
        if (pointInPolygon(lng, lat, poly)) return { iso: c.iso, name: c.name, exact: true };
      }
    }
    // Nearest-polygon fallback for coastal/island points.
    let best = null;
    let bestDist = NEAREST_TOLERANCE_DEG;
    for (const c of index) {
      const d = bboxDistance(lng, lat, c.bbox);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (best) return { iso: best.iso, name: best.name, exact: false };
    return { iso: 'XX', name: 'Unknown', exact: false };
  };
}
