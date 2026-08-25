# Phase 2: Contribution Gates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a pull request from a stranger safe to accept by hand — deterministic validation, a path guard, and a Gate 1 workflow, with no secrets anywhere.

**Architecture:** Two pure modules (`pathguard.mjs`, and the already-built `overlay.mjs` validator) behind one CLI (`validate-overlay.mjs`) that runs identically on a laptop and in CI. A `pull_request`-triggered workflow runs that CLI. Nothing in this phase touches a secret, calls a model, or reads trust levels.

**Tech Stack:** Node 24 ESM, `node:test`, GitHub Actions. No new dependencies.

**Read first:** [`../HANDOFF.md`](../HANDOFF.md), then [`../specs/2026-08-25-agent-contribution-system-design.md`](../specs/2026-08-25-agent-contribution-system-design.md), then [`../specs/2026-08-25-gate-2-trigger-security.md`](../specs/2026-08-25-gate-2-trigger-security.md).

---

## Scope

**In:** Gate 0 (path guard), Gate 1 (deterministic validation), a local validator contributors can run before submitting, the `gate.yml` workflow, and repository-level guards asserting the dangerous patterns stay absent.

**Out, deliberately:** the LLM manager, `ANTHROPIC_API_KEY`, trust levels, `contributors.json`, the spend ledger, auto-merge, the `workflow_run` trigger, and `_proposed/` new-spring files. All phase 3 or later.

**Why this split:** phase 2 introduces no secret, so nothing in it can leak one. It is independently useful — it makes hand-review safe — and it is the part that can be fully tested on a laptop.

## A warning specific to this phase

Gate 1 runs under `pull_request`. **On a fork PR the workflow file comes from the PR head**, so a contributor can rewrite `gate.yml` to report success on anything. Everything built here is *contributor convenience and maintainer signal*, never a security boundary. The security boundary is phase 3's Gate 2, which re-runs all of it from default-branch code.

Write that in the workflow as a comment. Someone will eventually assume a green check means something.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/lib/pathguard.mjs` | Which paths an outside PR may modify. Pure. |
| `scripts/validate-overlay.mjs` | CLI: validate overlay files, print actionable errors. |
| `.github/workflows/gate.yml` | Gate 1. No secrets, no `npm ci`. |
| `scripts/pathguard.test.mjs` | Tests for the guard. |
| `scripts/workflows.test.mjs` | Repo guards: forbidden patterns stay absent. |

---

## Task 1: The path guard

**Files:** Create `scripts/lib/pathguard.mjs`, `scripts/pathguard.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPaths, ALLOWED_PREFIX, MAX_CHANGED_FILES } from './lib/pathguard.mjs';

test('an overlay-only change is allowed', () => {
  assert.deepEqual(checkPaths(['data/overlay/whs_a1b2c3d4e5f6.json']), []);
});

test('touching the pipeline is rejected', () => {
  for (const p of [
    'scripts/build-dataset.mjs',
    'scripts/lib/exclusions.mjs',
    '.github/workflows/gate.yml',
    'src/App.tsx',
    'package.json',
    'data/hot-springs.json',
    'data/known-bad-imports.json',
  ]) {
    const errors = checkPaths([p]);
    assert.equal(errors.length, 1, `${p} should be rejected`);
    assert.match(errors[0], /may only modify/);
  }
});

test('path traversal cannot escape the overlay directory', () => {
  for (const p of [
    'data/overlay/../../scripts/ci/manager.mjs',
    'data/overlay/./../../package.json',
    'data/overlay/sub/dir/x.json',
  ]) {
    assert.ok(checkPaths([p]).length > 0, `${p} should be rejected`);
  }
});

test('a backslash path is normalised before checking', () => {
  // Windows contributors, and a trivially obvious evasion otherwise.
  assert.ok(checkPaths(['data\\overlay\\..\\..\\package.json']).length > 0);
});

test('only .json files are allowed in the overlay directory', () => {
  assert.ok(checkPaths(['data/overlay/notes.md']).length > 0);
  assert.ok(checkPaths(['data/overlay/evil.js']).length > 0);
});

test('the filename must match the spring id it declares', () => {
  // Enforced here because a mismatch means the file is invisible to anyone
  // grepping the directory for a spring.
  assert.ok(checkPaths(['data/overlay/not-an-id.json']).length > 0);
  assert.deepEqual(checkPaths(['data/overlay/whs_0123456789ab.json']), []);
});

test('an oversized changeset is rejected outright', () => {
  const many = Array.from({ length: MAX_CHANGED_FILES + 1 }, (_, i) =>
    `data/overlay/whs_${String(i).padStart(12, '0')}.json`);
  const errors = checkPaths(many);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /too many files/i);
});

test('ALLOWED_PREFIX is the overlay directory and nothing else', () => {
  assert.equal(ALLOWED_PREFIX, 'data/overlay/');
});
```

- [ ] **Step 2: Run it, confirm it fails** — `node --test scripts/pathguard.test.mjs`

- [ ] **Step 3: Implement**

```js
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
```

- [ ] **Step 4: Run it, confirm it passes**

- [ ] **Step 5: Mutation-check** — remove the `..` handling from the normaliser and confirm the traversal test fails. Restore. **`git checkout` will not restore this file; it is untracked. Restore by hand.**

- [ ] **Step 6: Commit** — stage explicit paths, not `-A`.

```bash
git add scripts/lib/pathguard.mjs scripts/pathguard.test.mjs
git commit -m "feat: path guard limiting contributions to data/overlay/

Stops the obvious attack -- a PR that edits the workflow or script that
reviews it. Paths are normalised before the prefix check, because a check that
runs before normalisation is an evasion rather than an edge case."
```

---

## Task 2: The validator CLI

**Files:** Create `scripts/validate-overlay.mjs`; modify `package.json`

Contributors run this before submitting; CI runs the identical code. One
implementation, so a green laptop run means a green CI run.

- [ ] **Step 1: Implement**

```js
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
import { checkPaths } from './lib/pathguard.mjs';

const OVERLAY_DIR = path.join('data', 'overlay');

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

  const overlayFiles = files.filter((f) => f.replace(/\\/g, '/').startsWith('data/overlay/'));
  if (overlayFiles.length === 0) {
    console.log('No overlay files to validate.');
    return;
  }

  let failed = 0;
  for (const file of overlayFiles) {
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

  console.log(`${overlayFiles.length} file(s) checked, ${failed} with problems.`);
  if (failed) process.exit(1);
}

main();
```

- [ ] **Step 2: Add the npm script**

```json
    "validate": "node scripts/validate-overlay.mjs",
```

- [ ] **Step 3: Verify by hand, both directions**

Write a valid overlay file for a real spring id from `data/hot-springs.json`,
run `npm run validate`, confirm it passes. Then break it three ways — a
non-claimable field (`type`), a temperature of `318`, a filename that does not
match the id — and confirm each is reported with a message that says what to do.

Delete the file afterwards. `git status` must be clean.

- [ ] **Step 4: Commit**

---

## Task 3: Gate 1 workflow

**Files:** Create `.github/workflows/gate.yml`

- [ ] **Step 1: Write it**

```yaml
# Gate 1 -- contributor feedback. NOT a security boundary.
#
# On a fork pull request the workflow file comes from the PR head, so a
# contributor can rewrite this file to report success on anything. A green
# check here means "the contributor's own copy of the validator was happy",
# nothing more. Phase 3's Gate 2 re-runs all of it from default-branch code,
# and that is the check that counts.
#
# No secrets. No `npm ci` -- the validator must never need the PR's dependency
# tree, because installing it would execute the PR's install scripts.
name: gate-1
on: pull_request

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@<pin-to-full-sha>
        with:
          fetch-depth: 0        # --changed-only diffs against the base
      - uses: actions/setup-node@<pin-to-full-sha>
        with:
          node-version: 24
      - env:
          BASE_REF: origin/${{ github.base_ref }}
        run: node scripts/validate-overlay.mjs --changed-only
```

- [ ] **Step 2: Pin the action SHAs**

Resolve each to a full commit SHA and replace the placeholders:

```bash
gh api repos/actions/checkout/git/refs/tags/v4 --jq .object.sha
gh api repos/actions/setup-node/git/refs/tags/v4 --jq .object.sha
```

A tag is mutable. An action author's compromise otherwise becomes ours.

- [ ] **Step 3: Commit**

---

## Task 4: Repository guards

Assertions that the dangerous patterns stay absent. These run in `npm test`, so
they fail on a laptop before they can fail in production.

**Files:** Create `scripts/workflows.test.mjs`

- [ ] **Step 1: Write the tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.github/workflows';
const workflows = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  : [];

test('there is at least one workflow to check', () => {
  assert.ok(workflows.length > 0, 'this suite is vacuous without workflows');
});

test('pull_request_target appears nowhere', () => {
  // It runs with secrets in the base context while checking out
  // contributor-controlled content. See specs/gate-2-trigger-security.md.
  for (const f of workflows) {
    const body = fs.readFileSync(path.join(DIR, f), 'utf8');
    assert.ok(!body.includes('pull_request_target'), `${f} uses pull_request_target`);
  }
});

test('every action is pinned to a full commit SHA', () => {
  for (const f of workflows) {
    const body = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const m of body.matchAll(/uses:\s*(\S+)/g)) {
      const ref = m[1].split('@')[1];
      assert.match(ref ?? '', /^[0-9a-f]{40}$/, `${f}: ${m[1]} is not pinned to a SHA`);
    }
  }
});

test('no workflow installs the pull request dependency tree', () => {
  // `npm ci` against a contributor's lockfile executes their install scripts.
  for (const f of workflows) {
    const body = fs.readFileSync(path.join(DIR, f), 'utf8');
    assert.ok(!/npm (ci|install)/.test(body), `${f} installs dependencies`);
  }
});

test('no workflow in this phase references a secret', () => {
  // Phase 2 introduces no secret, so nothing in it can leak one. This test
  // must be deliberately changed in phase 3, which is the point.
  for (const f of workflows) {
    const body = fs.readFileSync(path.join(DIR, f), 'utf8');
    assert.ok(!body.includes('secrets.'), `${f} references a secret; see the phase 3 security note`);
  }
});
```

- [ ] **Step 2: Run, confirm they pass against the workflow from Task 3**

- [ ] **Step 3: Mutation-check** — add `pull_request_target` to `gate.yml`, confirm the test fails, revert.

- [ ] **Step 4: Commit**

---

## Task 5: Documentation

**Files:** Modify `CONTRIBUTING.md`, `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: Document the submission flow in CONTRIBUTING.md**

Cover: run `npm run validate` before opening a PR; a PR may only touch
`data/overlay/**`; a green Gate 1 check is feedback, not approval; every
submission is reviewed by a human in this phase.

- [ ] **Step 2: Update HANDOFF.md** — mark phase 2 done, point at phase 3.

- [ ] **Step 3: Full green-path check**

```bash
npm test && npm run data:build && npx tsc -b --force && npm run build
```

- [ ] **Step 4: Commit**

---

## Manual configuration — not code, do not skip

These are repository settings. They cannot be committed, and two of them matter
more than anything in this plan.

- [ ] **Actions → Fork pull request workflows → "Require approval for all
      external contributors."** The default only covers first-time contributors,
      which is precisely the population that costs nothing.
- [ ] **Disable "Allow GitHub Actions reviews to count towards required
      approval"** at the org level. On by default; it lets a workflow token
      satisfy branch protection.
- [ ] **Branch protection on `main`** — require the Gate 1 check, require review,
      disallow force-push. Everything in the security note assumes an
      uncompromised default branch.

Record the date each was set in `HANDOFF.md`, because "we meant to" is
indistinguishable from "we did" six months later.

---

## Done when

- `npm test` passes, including the new guard suites
- `npm run validate` accepts a well-formed claim and rejects a malformed one with
  an actionable message
- `.github/workflows/gate.yml` exists, has no secrets, no `npm ci`, and pinned SHAs
- The repository guards fail if `pull_request_target`, an unpinned action, or a
  secret reference is introduced
- The three manual settings are applied and dated

## Explicitly not done in this phase

The LLM manager, the API key, trust levels, the spend ledger, auto-merge, the
`workflow_run` trigger, and `_proposed/` new-spring files.

**Phase 3 must not begin until
[`../specs/2026-08-25-gate-2-trigger-security.md`](../specs/2026-08-25-gate-2-trigger-security.md)
has been read in full.** Its first draft contained a path to the API key, and
the finding is preserved in that document precisely so the next implementer sees
how it happened rather than only the patched result.
