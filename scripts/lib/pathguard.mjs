/**
 * Which paths an outside pull request may modify.
 *
 * This is the guard that stops the obvious attack: a PR that edits the
 * workflow, script, or dataset that reviews it. In phase 2 it runs only in
 * untrusted CI, so it is a signal rather than a boundary -- phase 3 re-runs it
 * from trusted code, which is where it becomes load-bearing.
 */
export const ALLOWED_PREFIX = 'data/overlay/';

/** A data-correction atlas has no legitimate large pull request. */
export const MAX_CHANGED_FILES = 50;

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

// Gate verification PR. Not a real change; will be reverted.
