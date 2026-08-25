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
  // Assert the *reason*, not just the rejection. A guard that never resolves
  // `..` still rejects these -- as "no subdirectories", because the literal
  // `..` segment leaves a slash in the filename. That is an accident of the
  // path shape, not the guard working, and a test that accepts it passes with
  // the normaliser deleted.
  for (const p of [
    'data/overlay/../../scripts/ci/manager.mjs',
    'data/overlay/./../../package.json',
    'data/overlay/../overlay/../../package.json',
  ]) {
    const errors = checkPaths([p]);
    assert.equal(errors.length, 1, `${p} should be rejected`);
    assert.match(errors[0], /may only modify/, `${p} must be rejected as escaping the prefix`);
  }
});

test('the overlay directory has no subdirectories', () => {
  const errors = checkPaths(['data/overlay/sub/dir/x.json']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no subdirectories/);
});

test('a backslash path is normalised before checking', () => {
  // Windows contributors, and a trivially obvious evasion otherwise.
  const errors = checkPaths(['data\\overlay\\..\\..\\package.json']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /may only modify/);
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
