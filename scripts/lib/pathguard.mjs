/**
 * Which paths an outside pull request may modify.
 *
 * This is the guard that stops the obvious attack: a PR that edits the
 * workflow, script, or dataset that reviews it. In phase 2 it runs only in
 * untrusted CI, so it is a signal rather than a boundary -- phase 3 re-runs it
 * from trusted code, which is where it becomes load-bearing.
 */
export const ALLOWED_PREFIX = 'data/overlay/';

/**
 * Two artifacts an enrichment run must commit alongside its claims. Named
 * individually rather than by widening the prefix: `data/` also holds the
 * built dataset and the registry, and a contribution has no business in
 * either.
 */
export const ALLOWED_FILES = ['data/coverage.json', 'data/refutations.jsonl'];

/**
 * One enrichment run writes up to 258 overlay files -- TARGET_PER_COUNTRY (2)
 * x 129 countries -- plus the two artifacts above, so 260. The old limit of 50
 * predated any process that produced claims in bulk and would have rejected
 * every run.
 *
 * A run cannot actually reach 258, because 21 countries hold exactly one
 * spring, capping the real ceiling at 237. The limit is set from the
 * structural maximum rather than that empirical one: the spring count moves
 * with every OSM refresh, and a cap that tracks the data would fail the day a
 * 22nd single-spring country gained a neighbour.
 *
 * Hardcoded rather than imported on purpose -- deriving a security cap from
 * generated data lets the data decide its own ceiling. If TARGET_PER_COUNTRY
 * changes, this constant must be revisited by hand.
 *
 * Still a limit, and still outright: this is a data-correction atlas, and
 * nothing legitimate here touches a thousand files.
 */
export const MAX_CHANGED_FILES = 260;

const OVERLAY_FILE = /^whs_[0-9a-f]{12}\.json$/;

/** @returns {string[]} errors; empty means the changeset is acceptable. */
export function checkPaths(files) {
  if (files.length > MAX_CHANGED_FILES) {
    return [
      `too many files: ${files.length} changed, limit is ${MAX_CHANGED_FILES}. ` +
        'Split this into smaller submissions.',
    ];
  }

  const errors = [];
  for (const raw of files) {
    // Normalise before deciding anything. A backslash path or a `..` segment
    // that is checked before normalisation is an evasion, not an edge case.
    const p = raw.replace(/\\/g, '/');
    const normalised = [];
    for (const part of p.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') normalised.pop();
      else normalised.push(part);
    }
    const clean = normalised.join('/');

    if (ALLOWED_FILES.includes(clean)) continue;

    if (!clean.startsWith(ALLOWED_PREFIX)) {
      errors.push(`${raw}: a contribution may only modify ${ALLOWED_PREFIX}**`);
      continue;
    }
    const name = clean.slice(ALLOWED_PREFIX.length);
    if (name.includes('/')) {
      errors.push(`${raw}: ${ALLOWED_PREFIX} has no subdirectories`);
      continue;
    }
    if (!OVERLAY_FILE.test(name)) {
      errors.push(
        `${raw}: overlay files are named <spring-id>.json, e.g. whs_a1b2c3d4e5f6.json`,
      );
    }
  }
  return errors;
}
// path-guard probe
