/**
 * Deterministic build timestamps.
 *
 * The build previously stamped `new Date()` into every record's `lastVerified`
 * and into the GeoJSON metadata, so a rebuild that changed nothing still
 * produced a ~6MB diff touching all 6,471 records. Any real change was
 * invisible inside it, which makes the committed dataset unreviewable — and a
 * later phase accepts curated corrections as pull requests, so an unreviewable
 * diff is a review-integrity problem, not just an annoyance.
 *
 * The timestamp is derived from the inputs instead: SOURCE_DATE_EPOCH when the
 * caller sets it (the reproducible-builds convention), otherwise the newest
 * mtime among the raw tiles.
 *
 * Scope of the guarantee: identical inputs on one machine produce byte-identical
 * output. It does NOT hold across machines that fetched their own tiles, because
 * mtimes are local. That is what SOURCE_DATE_EPOCH is for — set it to pin a
 * build. `data/raw/` is gitignored and never cloned, so no git checkout can
 * silently reset the mtimes this depends on.
 */
import fs from 'node:fs';
import path from 'node:path';

export function buildTimestamp(rawDir, env = process.env) {
  if (env.SOURCE_DATE_EPOCH !== undefined && env.SOURCE_DATE_EPOCH !== '') {
    const seconds = Number(env.SOURCE_DATE_EPOCH);
    // Validated rather than trusted: `new Date(NaN).toISOString()` throws a
    // bare RangeError that says nothing about which input was wrong, and a
    // silently mis-parsed epoch would poison `lastVerified` on every record.
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 4102444800) {
      throw new Error(
        `SOURCE_DATE_EPOCH must be a Unix timestamp in seconds between 0 and ` +
          `4102444800 (2100-01-01), got ${JSON.stringify(env.SOURCE_DATE_EPOCH)}`,
      );
    }
    return new Date(seconds * 1000).toISOString();
  }

  const files = fs
    .readdirSync(rawDir)
    .filter((f) => f.startsWith('tile-') && f.endsWith('.json'));

  if (files.length === 0) {
    throw new Error(
      `no input files in ${rawDir}: refusing to fall back to the current time, ` +
        'which would make the build non-reproducible',
    );
  }

  const newest = Math.max(...files.map((f) => fs.statSync(path.join(rawDir, f)).mtimeMs));
  // Truncated to whole seconds. Some filesystems report sub-millisecond mtimes
  // and others do not, so keeping the fractional part would make the output
  // depend on which filesystem the tiles happen to live on.
  return new Date(Math.floor(newest / 1000) * 1000).toISOString();
}

export function buildDate(rawDir, env = process.env) {
  return buildTimestamp(rawDir, env).slice(0, 10);
}
