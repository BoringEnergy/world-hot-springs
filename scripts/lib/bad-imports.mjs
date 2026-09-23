/**
 * The reviewed list of things tagged as hot springs that are not.
 *
 * Pure: the parsed data/known-bad-imports.json in, a matcher out. The build
 * quarantines what it matches to data/suspect.json; nothing is deleted.
 *
 * Every entry is a judgement somebody made and wrote down, not a heuristic.
 * The obvious automatic rule ("a dense cluster of attribute-free nodes is an
 * import") flags 1,957 of Yellowstone's 1,959 attribute-free springs, and
 * those are real. So each entry says where it applies and why, in words a
 * reader can argue with.
 *
 * An entry matches a record when ALL of its conditions hold:
 *
 *   countries   the record's ISO country is listed
 *   bbox        optional [minLng, minLat, maxLng, maxLat]; the record is inside
 *   rule        attribute-free   the record carries nothing but the tag and a name
 *               name-pattern     the name matches `namePattern`, attributes or not:
 *                                a customer-register code proves the source
 *                                whatever else somebody added to the node
 *               listed           the record's id is in `ids`, one reviewed feature
 *                                at a time
 *   except      optional ids the entry would match and must not: reviewed genuine
 *               springs inside the entry's reach
 *
 * Country-wide attribute-free is right only where the review found no genuine
 * attribute-free spring in the country. Anywhere else the entry needs a box, a
 * pattern or a list, because the country also holds real springs that nobody
 * has attributed yet.
 */

export const RULES = new Set(['attribute-free', 'name-pattern', 'listed']);

function fail(where, msg) {
  throw new Error(`known-bad-imports.json: ${where} ${msg}`);
}

function checkIds(where, field, ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== 'string' || !x)) {
    fail(where, `"${field}" must be a non-empty list of record ids.`);
  }
  if (new Set(ids).size !== ids.length) fail(where, `"${field}" repeats an id.`);
}

/**
 * Validate the file and compile it. Throws on the first problem: a rule the
 * build does not understand would otherwise match nothing, silently.
 */
export function compileBadImports(file) {
  if (!file || !Array.isArray(file.imports)) fail('', 'has no "imports" list.');
  const seen = new Set();
  return file.imports.map((imp, i) => {
    const where = `imports[${i}]${imp?.id ? ` ("${imp.id}")` : ''}`;
    if (!imp?.id || typeof imp.id !== 'string') fail(where, 'has no id.');
    if (seen.has(imp.id)) fail(where, 'has a duplicate id.');
    seen.add(imp.id);
    if (!RULES.has(imp.rule)) fail(where, `has unknown rule "${imp.rule}".`);
    if (!Array.isArray(imp.countries) || imp.countries.length === 0) fail(where, 'lists no countries.');
    if (!imp.reason) fail(where, 'gives no reason.');

    let bbox = null;
    if (imp.bbox !== undefined) {
      const b = imp.bbox;
      if (!Array.isArray(b) || b.length !== 4 || b.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        fail(where, '"bbox" must be [minLng, minLat, maxLng, maxLat].');
      }
      if (b[0] >= b[2] || b[1] >= b[3]) fail(where, '"bbox" has its minimum above its maximum.');
      bbox = b;
    }

    let pattern = null;
    if (imp.rule === 'name-pattern') {
      if (typeof imp.namePattern !== 'string' || !imp.namePattern) fail(where, 'needs a "namePattern".');
      pattern = new RegExp(imp.namePattern, 'iu');
    } else if (imp.namePattern !== undefined) {
      fail(where, `has a "namePattern" its rule "${imp.rule}" would ignore.`);
    }

    let ids = null;
    if (imp.rule === 'listed') {
      checkIds(where, 'ids', imp.ids);
      ids = new Set(imp.ids);
    } else if (imp.ids !== undefined) {
      fail(where, `has "ids" its rule "${imp.rule}" would ignore.`);
    }

    let except = null;
    if (imp.except !== undefined) {
      checkIds(where, 'except', imp.except);
      except = new Set(imp.except);
    }

    return { id: imp.id, rule: imp.rule, countries: new Set(imp.countries), bbox, pattern, ids, except };
  });
}

function inBox([minLng, minLat, maxLng, maxLat], { lat, lng }) {
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

function matches(entry, record) {
  if (!entry.countries.has(record.location.country)) return false;
  if (entry.except?.has(record.id)) return false;
  if (entry.bbox && !inBox(entry.bbox, record.location)) return false;
  switch (entry.rule) {
    case 'attribute-free':
      return record.quality.attributeFree === true;
    case 'name-pattern':
      return entry.pattern.test(record.name ?? '');
    case 'listed':
      return entry.ids.has(record.id);
  }
  return false;
}

/** The first entry that matches the record, or null. */
export function matchBadImport(compiled, record) {
  return compiled.find((entry) => matches(entry, record)) ?? null;
}

/**
 * Ids that a `listed` or `except` entry names and no record carries.
 *
 * An entry that names a feature the upstream has since deleted or renumbered
 * is stale, and a stale `except` is worse: it no longer protects anything. The
 * build reports these rather than failing, because an upstream edit is not
 * this repository's defect.
 */
export function unmatchedIds(compiled, records) {
  const present = new Set(records.map((r) => r.id));
  const missing = [];
  for (const e of compiled) {
    for (const id of [...(e.ids ?? []), ...(e.except ?? [])]) {
      if (!present.has(id)) missing.push(`${e.id}: ${id}`);
    }
  }
  return missing;
}
