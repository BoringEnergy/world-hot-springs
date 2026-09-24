/**
 * The atlas beside the official count, where a country publishes one.
 *
 * Pure: data/reference/official-inventories.json and the atlas's own counts
 * in, comparison rows out. Accepted 2026-09-23 as decision 3 of
 * docs/superpowers/specs/2026-09-23-counting-unit.md.
 *
 * The atlas's number is a floor of what is publicly mapped, not a census.
 * Where a government has counted, this is how the atlas says how far it
 * reaches. The ratio is atlas / official between two differently defined
 * units, so it travels with the unit and the caveat that explain the
 * difference, and it is never called a percentage complete.
 */

const COMPARABLE = new Set(['features', 'sites']);

function fail(where, msg) {
  throw new Error(`official-inventories.json: ${where} ${msg}`);
}

/** Validate the file. Throws on the first problem, naming it. */
export function compileInventories(file) {
  if (!file || !Array.isArray(file.inventories)) fail('', 'has no "inventories" list.');
  const seen = new Set();
  for (const [i, inv] of file.inventories.entries()) {
    const where = `inventories[${i}]${inv?.id ? ` ("${inv.id}")` : ''}`;
    for (const key of ['id', 'country', 'publisher', 'title', 'url', 'asOf', 'reviewed']) {
      if (typeof inv?.[key] !== 'string' || !inv[key]) fail(where, `has no "${key}".`);
    }
    if (seen.has(inv.id)) fail(where, 'has a duplicate id.');
    seen.add(inv.id);
    if (!/^[A-Z]{2}$/.test(inv.country)) fail(where, '"country" must be an ISO 3166-1 alpha-2 code.');
    if (!/^https:\/\//.test(inv.url)) fail(where, '"url" must be an https link to the primary source.');
    if (!Array.isArray(inv.counts) || inv.counts.length === 0) fail(where, 'states no counts.');
    for (const c of inv.counts) {
      if (!Number.isInteger(c.count) || c.count <= 0) fail(where, `has a count that is not a positive integer: ${c.count}.`);
      if (!COMPARABLE.has(c.comparesWith)) fail(where, `compares with "${c.comparesWith}"; use features or sites.`);
      if (!c.unit) fail(where, 'has a count with no unit.');
      if (!c.caveat) fail(where, `gives no caveat for "${c.unit}". Every official unit differs from ours somehow; say how.`);
      if (c.countedByAtlas !== undefined && c.countedByAtlas !== true) fail(where, '"countedByAtlas" is true or absent.');
      if (c.countedByAtlas && !/count/i.test(c.caveat)) {
        fail(where, `counts "${c.unit}" itself but its caveat does not say so. A number the publisher never stated must read as ours.`);
      }
    }
  }
  return file.inventories;
}

/**
 * Countries whose published sources were read and hold no count comparable
 * with ours. Recorded as data so an absence is a finding with its evidence,
 * not a silence a reader could mistake for "not looked at".
 */
export function compileChecked(file) {
  const list = file.withoutComparableCount ?? [];
  for (const [i, c] of list.entries()) {
    const where = `withoutComparableCount[${i}]`;
    if (!/^[A-Z]{2}$/.test(c?.country ?? '')) fail(where, '"country" must be an ISO 3166-1 alpha-2 code.');
    if (!c.reviewed || !c.finding) fail(where, 'needs "reviewed" and "finding".');
    if (!Array.isArray(c.checked) || c.checked.length === 0 || c.checked.some((u) => !/^https:\/\//.test(u))) {
      fail(where, '"checked" must list the https sources that were read.');
    }
  }
  return list;
}

/**
 * @param inventories  compileInventories() output
 * @param atlas        { features: {ISO: n}, sites: {ISO: n}, names: {ISO: name} }
 */
export function compareWithInventories(inventories, atlas) {
  const rows = [];
  for (const inv of inventories) {
    for (const c of inv.counts) {
      const mine = atlas[c.comparesWith][inv.country] ?? 0;
      rows.push({
        inventory: inv.id,
        country: inv.country,
        countryName: atlas.names[inv.country] ?? null,
        publisher: inv.publisher,
        source: inv.url,
        asOf: inv.asOf,
        unit: c.unit,
        official: c.count,
        comparesWith: c.comparesWith,
        atlas: mine,
        ratio: Math.round((mine / c.count) * 100) / 100,
        countedByAtlas: c.countedByAtlas === true,
        caveat: c.caveat,
      });
    }
  }
  return rows;
}
