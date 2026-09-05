/**
 * Guards on data/overlay/, the only layer here that cannot be rebuilt.
 *
 * data/raw/, data/hot-springs.*, and the registry all regenerate from OSM.
 * An authored overlay destroyed by a buggy enrichment run is simply gone, so
 * these assert -- from the source text, cheaply, on every run -- that the
 * enrichment CLI can only ever create a file there, and that the refutation
 * log cannot become a back door into the published site.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveRoles, vendorOf } from './lib/providers/index.mjs';

const ENRICH = 'scripts/enrich.mjs';

test('the build never reads the refutation log', () => {
  // Otherwise the log is a back door for publishing exactly the values that
  // verification rejected.
  for (const f of ['scripts/build-dataset.mjs', 'scripts/lib/overlay.mjs', 'scripts/lib/normalize.mjs']) {
    assert.ok(!fs.readFileSync(f, 'utf8').includes('refutations'), `${f} reads the refutation log`);
  }
});

test('the enrichment CLI never deletes or truncates an overlay file', () => {
  const src = fs.readFileSync(ENRICH, 'utf8');
  // Wider than "delete". renameSync moves a file out from under its name,
  // copyFileSync overwrites its destination, and openSync with a write flag
  // truncates -- each destroys an authored claim as thoroughly as unlinkSync,
  // and the first list here named none of them.
  const forbidden = [
    'unlinkSync', 'rmSync', 'rmdirSync', 'truncateSync', 'ftruncateSync',
    'renameSync', 'copyFileSync', 'cpSync', 'openSync',
    // The promise API reaches the same syscalls under different names.
    '.unlink(', '.rm(', '.rmdir(', '.truncate(', '.rename(', '.copyFile(', '.cp(',
  ];
  for (const call of forbidden) {
    assert.ok(!src.includes(call), `${ENRICH} calls ${call}`);
  }
});

test('the enrichment CLI checks for an existing overlay file before writing one', () => {
  const src = fs.readFileSync(ENRICH, 'utf8');
  const check = src.indexOf('existsSync(file)');
  assert.notEqual(check, -1, 'no existsSync(file) guard at all');

  // Presence is not the property that matters. A check that has drifted below
  // the write still matches /existsSync\(file\)/ while overwriting an authored
  // overlay on every run, so assert position: every write of `file` must come
  // after the guard.
  const writes = [...src.matchAll(/writeFileSync\(\s*file\b/g)].map((m) => m.index);
  assert.notEqual(writes.length, 0, 'no writeFileSync(file) to guard');
  for (const write of writes) {
    assert.ok(check < write, 'the existsSync(file) guard sits after the write it is meant to prevent');
  }
});

test('the provider config is gitignored', () => {
  // It names models and may carry endpoints; the example file is the committed one.
  assert.match(fs.readFileSync('.gitignore', 'utf8'), /enrichment\.config\.json/);
});

test('the example config names a vendor that has a module, and two of them', () => {
  // The coupling is invisible until it costs a run: `xai:` loads
  // providers/xai.mjs, whose gateway prefix is `spacexai/`. Writing the
  // gateway prefix into the config instead of the vendor fails at
  // module-resolution time, after the plan has been loaded -- which is exactly
  // when it happened.
  const config = JSON.parse(fs.readFileSync('enrichment.config.example.json', 'utf8'));
  const roles = resolveRoles(config);
  for (const id of [roles.proposer, roles.verifier]) {
    const vendor = vendorOf(id);
    assert.ok(
      fs.existsSync(path.join('scripts', 'lib', 'providers', `${vendor}.mjs`)),
      `${id} names vendor "${vendor}", which has no module in scripts/lib/providers/`,
    );
    assert.ok(String(id).includes(':'), `${id} is missing the vendor:model separator`);
  }
});

test('the default proposer is not a reasoning model', () => {
  // Measured on the live gateway over 492 candidates: grok-4.6 costs $7.26 a
  // run against a $5 credit, grok-4.1-fast-non-reasoning $1.96. Reasoning
  // tokens were 1345 of 1350 on a proposal call. Now that retrieval is solved
  // the proposer extracts from supplied text, which does not need reasoning.
  const config = JSON.parse(fs.readFileSync('enrichment.config.example.json', 'utf8'));
  assert.match(config.proposer, /non-reasoning/,
    'the default proposer must be a non-reasoning model, or a full run does not fit the credit');
});

test('no unreviewed script reaches the overlay directory', () => {
  // The guards above name one file. A new script that writes to data/overlay/
  // would be invisible to them, so pin the roster instead: any script that
  // mentions the directory must be on this list, and adding one to the list is
  // the moment to check it against the guards above.
  const reviewed = [
    'scripts/build-dataset.mjs',   // reads overlays via loadOverlays
    'scripts/enrich.mjs',          // the only writer, guarded above
    'scripts/lib/pathguard.mjs',   // names the directory as an allowed PR prefix
    'scripts/validate-overlay.mjs',// read-only validation
    'scripts/verify-claims.mjs',   // read-only: reads overlays, fetches their sources, writes nothing
    'scripts/ci/gate-2.mjs',       // read-only: fetches PR overlays to a temp dir, never into the checkout
    'scripts/ci/lib/fetch-contrib.mjs' // writes ONLY to a caller-supplied temp dir, names by content hash
  ];

  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs')) {
        const rel = p.split(path.sep).join('/');
        if (/data[/\\]overlay|'data',\s*'overlay'/.test(fs.readFileSync(p, 'utf8'))) found.push(rel);
      }
    }
  };
  walk('scripts');

  assert.deepEqual(
    found.sort(),
    [...reviewed].sort(),
    'a script touching data/overlay/ was added or removed -- check it against the guards in this file, then update the list',
  );
});
