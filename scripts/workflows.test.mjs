/**
 * Repository guards: the dangerous workflow patterns stay absent.
 *
 * These run in `npm test`, so they fail on a laptop before they can fail in
 * production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.github/workflows';
const workflows = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  : [];

/**
 * Strip YAML comments before scanning.
 *
 * A workflow that documents why it does not use `npm ci` contains the string
 * `npm ci`. Scanning the raw text makes the honest workflow fail and rewards
 * deleting the explanation, which is exactly backwards. A comment cannot leak
 * a secret or install a dependency tree; only a directive can.
 *
 * This is a lexer, not a parser: a `#` inside a quoted string would be treated
 * as a comment. No workflow here has one, and the guard below fails loudly
 * rather than silently if that ever stops being true.
 *
 * Line endings are normalised first, and that is not cosmetic. `\r` is a line
 * terminator to a JavaScript regex, so `.` stops before it and a trailing `$`
 * never matches -- on a CRLF checkout, which is what git hands a Windows
 * contributor, the stripper silently returned every comment unchanged and the
 * guards below scanned prose instead of directives.
 */
function directives(body) {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

const bodies = workflows.map((f) => ({
  file: f,
  raw: fs.readFileSync(path.join(DIR, f), 'utf8'),
  code: directives(fs.readFileSync(path.join(DIR, f), 'utf8')),
}));

test('there is at least one workflow to check', () => {
  assert.ok(workflows.length > 0, 'this suite is vacuous without workflows');
});

test('the comment stripper actually strips, and keeps directives', () => {
  // Every guard below is vacuous if this is broken -- it would silently see an
  // empty document and pass. Same failure shape as an empty exclusion list
  // turning the privacy filter into a no-op.
  assert.equal(directives('  run: echo hi # npm ci'), '  run: echo hi');
  assert.equal(directives('# secrets.FOO'), '');
  assert.equal(directives('  uses: a/b@sha'), '  uses: a/b@sha');
  // A CRLF checkout must strip identically. It did not, once.
  assert.equal(directives('# npm ci\r\n  run: node x.mjs\r\n'), '\n  run: node x.mjs\n');
  for (const { file, code } of bodies) {
    assert.match(code, /uses:|run:/, `${file}: stripping left nothing to check`);
  }
});

test('pull_request_target appears nowhere', () => {
  // It runs with secrets in the base context while checking out
  // contributor-controlled content. See specs/gate-2-trigger-security.md.
  // Checked against the raw text on purpose: there is no reason to write it in
  // a comment either, and a near-miss there is worth catching.
  for (const { file, raw } of bodies) {
    assert.ok(!raw.includes('pull_request_target'), `${file} uses pull_request_target`);
  }
});

test('every action is pinned to a full commit SHA', () => {
  for (const { file, code } of bodies) {
    for (const m of code.matchAll(/uses:\s*(\S+)/g)) {
      const ref = m[1].split('@')[1];
      assert.match(ref ?? '', /^[0-9a-f]{40}$/, `${file}: ${m[1]} is not pinned to a SHA`);
    }
  }
});

test('no workflow installs the pull request dependency tree', () => {
  // `npm ci` against a contributor's lockfile executes their install scripts.
  for (const { file, code } of bodies) {
    assert.ok(!/npm (ci|install)/.test(code), `${file} installs dependencies`);
  }
});

test('no workflow in this phase references a secret', () => {
  // Phase 2 introduces no secret, so nothing in it can leak one. This test
  // must be deliberately changed in phase 3, which is the point.
  for (const { file, code } of bodies) {
    assert.ok(
      !code.includes('secrets.'),
      `${file} references a secret; see the phase 3 security note`,
    );
  }
});
