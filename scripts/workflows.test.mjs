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

/*
 * Installing dependencies: one workflow may, on conditions.
 *
 * This used to be one rule -- no workflow runs `npm ci` or `npm install` --
 * because `npm ci` against a contributor's lockfile executes their install
 * scripts. The browser harness (ui.yml) cannot work without the tree, so the
 * rule moved on 2026-09-16, deliberately and narrowly. The reasoning is in
 * docs/superpowers/specs/2026-09-16-browser-harness-ci.md; the short version is
 * that an allowed file must be a context with nothing in it worth stealing,
 * and every test below is one of the conditions that makes that true.
 *
 * These guard the maintainer against a mistake, not the repository against an
 * attacker: on a fork pull request the workflow files come from the PR head,
 * and a hostile contributor edits this test in the same commit.
 */
const NPM_CI_ALLOWED = ['ui.yml'];
const ALLOWED_TRIGGERS = new Set(['pull_request', 'push', 'workflow_dispatch']);
/** The contexts branch protection requires, and the workflow name gate-2 listens for. */
const RESERVED_JOB_NAMES = new Set(['validate', 'gate-2 claims']);
const RESERVED_WORKFLOW_NAME = 'gate-1';

/** Non-blank directive lines, with their indentation. */
function lines(code) {
  return code
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => ({ indent: l.match(/^ */)[0].length, text: l.trim() }));
}

const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

/** A top-level key: the text after its colon, and every line nested under it. */
function block(code, key) {
  const ls = lines(code);
  const i = ls.findIndex((l) => l.indent === 0 && l.text.startsWith(`${key}:`));
  if (i === -1) return null;
  const body = [];
  for (const l of ls.slice(i + 1)) {
    if (l.indent === 0) break;
    body.push(l);
  }
  return { value: ls[i].text.slice(key.length + 1).trim(), body };
}

/** Keys at the shallowest indentation of a block body. */
function childKeys(body) {
  if (body.length === 0) return [];
  const min = Math.min(...body.map((l) => l.indent));
  return body.filter((l) => l.indent === min).map((l) => unquote(l.text.split(':')[0]));
}

function triggers(code) {
  const on = block(code, 'on');
  if (!on) return [];
  if (on.value) return on.value.split(/[[\],\s]+/).filter(Boolean);
  return childKeys(on.body);
}

/** Every step (a `- ` item) that `uses:` the given action, as its directive lines. */
function stepsUsing(code, action) {
  const ls = lines(code);
  const steps = [];
  ls.forEach((l, i) => {
    if (!new RegExp(`^(- )?uses:\\s*${action}@`).test(l.text)) return;
    let start = i;
    while (start > 0 && !(ls[start].text.startsWith('- ') && ls[start].indent <= l.indent)) start -= 1;
    const step = [ls[start]];
    for (const next of ls.slice(start + 1)) {
      if (next.indent <= ls[start].indent) break;
      step.push(next);
    }
    steps.push(step.map((s) => s.text.replace(/^- /, '')));
  });
  return steps;
}

test('npm install appears in no workflow', () => {
  // `npm install` rewrites the lockfile it was given. Nothing in CI should
  // ever resolve a dependency tree; it installs the committed one or nothing.
  for (const { file, code } of bodies) {
    assert.ok(!/\bnpm (install|i|add)\b/.test(code), `${file} runs npm install`);
  }
});

test('npm ci appears only in an allowed workflow, and always without install scripts', () => {
  for (const { file, code } of bodies) {
    const installs = [...code.matchAll(/\bnpm ci\b[^\n]*/g)].map((m) => m[0]);
    if (installs.length === 0) continue;
    assert.ok(NPM_CI_ALLOWED.includes(file), `${file} runs npm ci but is not in NPM_CI_ALLOWED`);
    for (const line of installs) {
      assert.match(line, /--ignore-scripts\b/, `${file}: \`${line}\` would run install scripts`);
    }
  }
});

test('a workflow allowed to install has nothing in it worth stealing', () => {
  const allowed = bodies.filter(({ file }) => NPM_CI_ALLOWED.includes(file));
  assert.equal(allowed.length, NPM_CI_ALLOWED.length, 'NPM_CI_ALLOWED names a workflow that does not exist');
  for (const { file, code } of allowed) {
    // Exactly one permissions key, top level, granting read on contents and
    // nothing else. A job-level block could widen it for one job.
    assert.equal((code.match(/^\s*permissions:/gm) ?? []).length, 1, `${file}: exactly one permissions block`);
    const perms = block(code, 'permissions');
    assert.ok(perms, `${file}: permissions must be declared at the top level`);
    assert.equal(perms.value, '', `${file}: permissions must be a block, not \`${perms.value}\``);
    assert.deepEqual(perms.body.map((l) => l.text), ['contents: read'], `${file}: permissions must be contents: read alone`);

    // Unprivileged triggers only. Each of the others runs with the base
    // repository's secrets or a writable token.
    const on = triggers(code);
    assert.ok(on.length > 0, `${file}: no triggers found; the parser is broken`);
    for (const t of on) assert.ok(ALLOWED_TRIGGERS.has(t), `${file}: trigger \`${t}\` is not allowed here`);

    // The token must not be left in .git/config for a later step to read.
    const checkouts = stepsUsing(code, 'actions/checkout');
    assert.ok(checkouts.length > 0, `${file}: no checkout found; the parser is broken`);
    for (const step of checkouts) {
      assert.ok(step.includes('persist-credentials: false'), `${file}: a checkout keeps its credentials`);
    }

    // It must not be able to pass for a required check.
    const name = unquote(block(code, 'name')?.value ?? '');
    assert.notEqual(name, RESERVED_WORKFLOW_NAME, `${file}: gate-2 would treat this workflow as gate-1`);
    const jobs = block(code, 'jobs');
    assert.ok(jobs, `${file}: no jobs`);
    const ids = childKeys(jobs.body);
    const min = Math.min(...jobs.body.map((l) => l.indent));
    const names = jobs.body
      .filter((l) => l.indent === min + 2 && l.text.startsWith('name:'))
      .map((l) => unquote(l.text.slice('name:'.length)));
    for (const job of [...ids, ...names]) {
      assert.ok(!RESERVED_JOB_NAMES.has(job), `${file}: a job called \`${job}\` would satisfy a required check`);
    }
  }
});

test('the two gates install nothing and run no npm at all', () => {
  // gate-2 has checks: write; gate-1's verdict feeds it. Neither needs a
  // dependency tree, and neither may grow one.
  for (const { file, code } of bodies.filter(({ file }) => ['gate.yml', 'gate-2.yml'].includes(file))) {
    assert.ok(!/\bnpm\b/.test(code), `${file} runs npm`);
  }
  assert.equal(bodies.filter(({ file }) => ['gate.yml', 'gate-2.yml'].includes(file)).length, 2, 'a gate is missing');
});

test('no workflow downloads an artifact', () => {
  // The classic workflow_run attack: a privileged workflow downloads an
  // artifact an untrusted run uploaded, and executes or trusts it.
  for (const { file, code } of bodies) {
    assert.ok(!/download-artifact/.test(code), `${file} downloads an artifact`);
  }
});

test('only gate-2 is triggered by another workflow', () => {
  // workflow_run runs from the default branch WITH secrets. One such file is
  // a design decision (the security spec); a second is an accident.
  for (const { file, code } of bodies) {
    if (file === 'gate-2.yml') continue;
    assert.ok(!/\bworkflow_run\b/.test(code), `${file} uses workflow_run`);
  }
});

test('no workflow caches anything', () => {
  // A poisoned dependency in a push-to-main run could write a main-scoped
  // cache that every later run restores.
  for (const { file, code, raw } of bodies) {
    assert.ok(!/uses:\s*actions\/cache\b/.test(code), `${file} uses actions/cache`);
    assert.ok(!/^\s*(- )?cache:/m.test(code), `${file} turns on a setup-node cache`);
    // setup-node v5 caches npm by default whenever package.json exists. The
    // version is read from the pin's comment, so a pin without one fails.
    for (const m of raw.matchAll(/uses:\s*actions\/setup-node@\S+(.*)/g)) {
      const major = Number(m[1].match(/#\s*v(\d+)/)?.[1]);
      assert.ok(Number.isInteger(major), `${file}: setup-node pin has no # vN comment`);
    }
    const majors = [...raw.matchAll(/uses:\s*actions\/setup-node@\S+\s*#\s*v(\d+)/g)].map((m) => Number(m[1]));
    stepsUsing(code, 'actions/setup-node').forEach((step, i) => {
      if (majors[i] >= 5) {
        assert.ok(step.includes('package-manager-cache: false'), `${file}: setup-node v${majors[i]} caches unless told not to`);
      }
    });
  }
});

test('no workflow runs npx', () => {
  // npx fetches whatever the name resolves to when it is not installed. The
  // scripts in package.json run the pinned binaries and nothing else.
  for (const { file, code } of bodies) {
    assert.ok(!/\bnpx\b/.test(code), `${file} runs npx`);
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
