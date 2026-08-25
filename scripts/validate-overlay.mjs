/**
 * Validate curated overlay claims.
 *
 * Runs identically on a contributor's laptop and in CI, so "it passed locally"
 * means something. Prints every problem at once rather than the first, because
 * an agent fixing them one round-trip at a time is a bad experience.
 *
 * Usage:
 *   node scripts/validate-overlay.mjs                  # every file in data/overlay
 *   node scripts/validate-overlay.mjs --changed-only   # files changed vs origin/main
 *   node scripts/validate-overlay.mjs --files a.json b.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateOverlay } from './lib/overlay.mjs';
import { checkPaths, ALLOWED_PREFIX } from './lib/pathguard.mjs';

const OVERLAY_DIR = path.join('data', 'overlay');

const slash = (p) => p.replace(/\\/g, '/');

function changedFiles() {
  const base = process.env.BASE_REF || 'origin/main';
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function main() {
  const args = process.argv.slice(2);
  let files;

  if (args.includes('--changed-only')) {
    files = changedFiles();
    const pathErrors = checkPaths(files);
    if (pathErrors.length) {
      console.error('Path guard rejected this changeset:\n');
      for (const e of pathErrors) console.error(`  ${e}`);
      process.exit(1);
    }
  } else if (args.includes('--files')) {
    files = args.slice(args.indexOf('--files') + 1);
  } else {
    files = fs.existsSync(OVERLAY_DIR)
      ? fs.readdirSync(OVERLAY_DIR).filter((f) => f.endsWith('.json'))
          .map((f) => path.join(OVERLAY_DIR, f))
      : [];
  }

  // An explicit --files argument outside the overlay is a mistake worth
  // saying out loud. Silently dropping it and exiting 0 would tell a
  // contributor their file passed when it was never looked at.
  const outside = files.filter((f) => !slash(f).startsWith(ALLOWED_PREFIX));
  const overlayFiles = files.filter((f) => slash(f).startsWith(ALLOWED_PREFIX));

  // A deletion is a legitimate submission -- a removal request, or retracting
  // a claim -- but the file is gone, so there is nothing to parse. Reading it
  // anyway reports "not valid JSON", which sends a contributor hunting for a
  // syntax error in a file they deliberately removed.
  const removed = overlayFiles.filter((f) => !fs.existsSync(f));
  const present = overlayFiles.filter((f) => fs.existsSync(f));

  let failed = outside.length;
  for (const f of outside) {
    console.error(`${f}: not an overlay file; this validator only checks ${ALLOWED_PREFIX}**`);
  }

  for (const file of present) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`${file}: not valid JSON -- ${err.message}`);
      failed++;
      continue;
    }
    const errors = validateOverlay(parsed);
    // The filename must match the id inside, or the file is invisible to
    // anyone grepping the directory for a spring.
    const expected = `${parsed?.id}.json`;
    if (parsed?.id && path.basename(file) !== expected) {
      errors.push(`filename must be ${expected} to match the declared id`);
    }
    if (errors.length) {
      console.error(`${file}:`);
      for (const e of errors) console.error(`  ${e}`);
      failed++;
    }
  }

  if (removed.length) {
    // Not a failure. It is a fact a human reviewer needs, because deleting an
    // overlay file discards authored claims that no rebuild will bring back.
    console.log(
      `${removed.length} overlay file(s) removed; removing authored claims needs a human reviewer:`,
    );
    for (const f of removed) console.log(`  ${slash(f)}`);
  }

  if (present.length === 0 && removed.length === 0 && outside.length === 0) {
    console.log('No overlay files to validate.');
    return;
  }

  console.log(`${present.length} file(s) checked, ${failed} with problems.`);
  if (failed) process.exit(1);
}

main();
