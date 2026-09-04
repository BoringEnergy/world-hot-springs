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
const DATASET = path.join('data', 'hot-springs.json');

/**
 * Every id in the published dataset, or null when it cannot be read.
 *
 * Null disables the existence check rather than failing the whole run: a
 * contributor's claim should not be blocked because the dataset is unreadable
 * on their machine, and checking everything except existence beats checking
 * nothing. But the skip is announced -- a gate that quietly turns itself off
 * and still prints success is worse than one that fails.
 */
function knownSpringIds() {
  if (!fs.existsSync(DATASET)) {
    console.warn(`WARNING: ${DATASET} is missing; skipping the spring-existence check.`);
    return null;
  }
  try {
    return new Set(JSON.parse(fs.readFileSync(DATASET, 'utf8')).map((s) => s.id));
  } catch (err) {
    // Broader than a parse failure: an unexpected shape makes .map throw, and
    // an unreadable or half-written file lands here too.
    console.warn(`WARNING: ${DATASET} unreadable (${err.message}); skipping the spring-existence check.`);
    return null;
  }
}

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
  // Whether the caller named these files, or we discovered them from the diff.
  let explicitFiles = false;

  if (args.includes('--changed-only')) {
    files = changedFiles();
    // The path guard constrains strangers, so it applies to fork pull
    // requests only. Applied to every PR it failed each maintainer change
    // touching a script or a doc -- a required check the maintainers could
    // satisfy only by bypassing it, which is worse than no check, because it
    // teaches everyone to reach for the bypass.
    //
    // The job still RUNS on every PR and still validates every overlay file;
    // only the path restriction is scoped. A required check that gets skipped
    // stays pending forever and blocks a merge as hard as a failing one.
    //
    // Trusting a workflow-supplied flag is safe only because gate-1 was never
    // a security boundary: on a fork PR the workflow file comes from the PR
    // head, so a contributor could already rewrite this to report success.
    // Phase 4's Gate 2 re-runs the path guard from default-branch code.
    if (process.env.IS_FORK_PR === 'true') {
      const pathErrors = checkPaths(files);
      if (pathErrors.length) {
        console.error('Path guard rejected this changeset:');
        for (const e of pathErrors) console.error(`  ${e}`);
        process.exit(1);
      }
    } else {
      console.log('Same-repo change: validating overlay files, path guard not applied.');
    }
  } else if (args.includes('--files')) {
    explicitFiles = true;
    files = args.slice(args.indexOf('--files') + 1);
  } else {
    files = fs.existsSync(OVERLAY_DIR)
      ? fs.readdirSync(OVERLAY_DIR).filter((f) => f.endsWith('.json'))
          .map((f) => path.join(OVERLAY_DIR, f))
      : [];
  }

  // An explicit --files argument outside the overlay is a mistake worth saying
  // out loud: silently dropping it and exiting 0 would tell a contributor their
  // file passed when it was never opened.
  //
  // A *changed* file outside the overlay is a different thing entirely. On a
  // same-repo pull request it is the ordinary case -- a script, a doc, a test --
  // and it is not this validator's business. Only files the caller named are
  // held to it; changed files are simply filtered.
  const outside = explicitFiles
    ? files.filter((f) => !slash(f).startsWith(ALLOWED_PREFIX))
    : [];
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

  // Only when there is something to check against it; the dataset is 5.5 MB.
  const knownIds = present.length ? knownSpringIds() : null;

  for (const file of present) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`${file}: not valid JSON -- ${err.message}`);
      failed++;
      continue;
    }
    const errors = validateOverlay(parsed, { knownIds });
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
