/**
 * Tests the CLI, not the library.
 *
 * Every one of these runs the validator in a throwaway root rather than the
 * repository. `OVERLAY_DIR` and `DATASET` are both relative to cwd, so a temp
 * root swaps the whole world out with no production change -- and no test can
 * leave a fabricated claim behind in data/overlay/, which is the one layer
 * here that no rebuild can reconstruct. A `finally` would not survive Ctrl-C.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = path.resolve('scripts', 'validate-overlay.mjs');

/** A root containing data/overlay/ and, unless omitted, a stub dataset. */
function makeRoot(dataset) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whs-cli-'));
  fs.mkdirSync(path.join(root, 'data', 'overlay'), { recursive: true });
  if (dataset !== undefined) {
    fs.writeFileSync(path.join(root, 'data', 'hot-springs.json'), dataset);
  }
  return root;
}

function writeOverlay(root, overlay) {
  const rel = `data/overlay/${overlay.id}.json`;
  fs.writeFileSync(path.join(root, rel), JSON.stringify(overlay));
  return rel;
}

/** spawnSync, not execFileSync: the latter hands back stderr only on failure,
 *  and the skip warning this asserts on is printed by a run that succeeds. */
function runChangedOnly(env) {
  const r = spawnSync('node', ['scripts/validate-overlay.mjs', '--changed-only'], {
    encoding: 'utf8',
    env: { ...process.env, IS_FORK_PR: '', ...env },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function runCli(root, file) {
  const r = spawnSync('node', [CLI, '--files', file], { cwd: root, encoding: 'utf8' });
  if (r.error) throw r.error;
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const REAL = 'whs_b803e624c229';
const DATASET = JSON.stringify([{ id: REAL }]);

test('the CLI rejects an overlay naming a nonexistent spring', () => {
  // Exercises the wiring, not the library. The library test passes even when
  // the CLI forgets to pass knownIds -- which is exactly what it did.
  const root = makeRoot(DATASET);
  try {
    const file = writeOverlay(root, { id: 'whs_000000000000', claims: {} });
    const { code, out } = runCli(root, file);
    assert.equal(code, 1);
    assert.match(out, /not a spring in this dataset/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the CLI accepts an overlay for a real spring', () => {
  const root = makeRoot(DATASET);
  try {
    const file = writeOverlay(root, {
      id: REAL,
      claims: { description: { value: 'x', source: 'https://e.org', contributor: 'test' } },
    });
    const { code, out } = runCli(root, file);
    assert.equal(code, 0);
    assert.match(out, /1 file\(s\) checked, 0 with problems/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a missing dataset skips the existence check, loudly', () => {
  const root = makeRoot(undefined);
  try {
    const file = writeOverlay(root, { id: 'whs_000000000000', claims: {} });
    const { code, out } = runCli(root, file);
    assert.equal(code, 0, 'an unreadable dataset must not block a contributor');
    assert.match(out, /skipping the spring-existence check/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a dataset of an unexpected shape skips the check rather than crashing', () => {
  // Parses fine, then .map((s) => s.id) throws. The bare catch used to swallow
  // this and print success.
  const root = makeRoot('{"springs":[]}');
  try {
    const file = writeOverlay(root, { id: 'whs_000000000000', claims: {} });
    const { code, out } = runCli(root, file);
    assert.equal(code, 0);
    assert.match(out, /unreadable/);
    assert.match(out, /skipping the spring-existence check/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A throwaway git repo whose HEAD touches one non-overlay file.
 *
 * The first version of these tests used `BASE_REF: HEAD~1` against this
 * repository, so whether the guard fired depended on what the previous commit
 * happened to touch. It passed on a branch whose last commit was a doc and
 * failed on main whose last commit was an overlay -- a test that reports on
 * repository history rather than on the behaviour it names.
 */
function repoTouching(file) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whs-guard-'));
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), '{}');
  git('add', '-A');
  git('commit', '-qm', 'change');
  return root;
}

function guardRun(root, env) {
  const r = spawnSync('node', [CLI, '--changed-only'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, IS_FORK_PR: '', BASE_REF: 'HEAD~1', ...env },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('the path guard applies to a fork pull request', () => {
  // The guard exists to constrain strangers, and for a stranger it must bite.
  const root = repoTouching('scripts/evil.mjs');
  const { code, out } = guardRun(root, { IS_FORK_PR: 'true' });
  assert.equal(code, 1, out);
  assert.match(out, /may only modify/);
});

test('a same-repo pull request is not held to the path guard', () => {
  // Applied to every PR it failed each maintainer change touching a script or
  // a doc, making a required check only a bypass could satisfy. The job still
  // runs and still validates overlay files; only the path rule is scoped.
  const root = repoTouching('scripts/evil.mjs');
  const { code, out } = guardRun(root, {});
  assert.equal(code, 0, out);
  assert.match(out, /path guard not applied/);
  assert.doesNotMatch(out, /may only modify/);
});

test('a changed file outside the overlay is ignored, but a named one is refused', () => {
  // Different questions. "This diff touches a script" is ordinary on a
  // same-repo PR; "validate this script for me" is a mistake worth naming.
  const root = repoTouching('scripts/evil.mjs');
  assert.equal(guardRun(root, {}).code, 0);
  const named = runCli(process.cwd(), 'package.json');
  assert.equal(named.code, 1);
  assert.match(named.out, /not an overlay file/);
});
