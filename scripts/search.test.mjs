import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  createSearch,
  resolveLauncher,
  sanitizeQuery,
  AUTH_COMMAND,
  SEARCH_LIMIT_PER_MIN,
} from './lib/search.mjs';

/**
 * Captured from one real `tinyfish search query` run against Gamla Laugin, the
 * spring Task 12 was diagnosed on. Verbatim but trimmed to three of eight
 * results -- the parser must not be tested against a shape we invented.
 */
const LIVE_CAPTURE = JSON.stringify({
  query: 'Gamla Laugin Secret Lagoon Fludir Iceland water temperature',
  total_results: 8,
  page: 0,
  results: [
    {
      position: 1,
      site_name: 'secretlagoon.is',
      snippet: 'The Secret Lagoon, known locally as Gamla Laugin, is the oldest swimming pool in Iceland.',
      title: 'Secret Lagoon Iceland - Secret Lagoon Iceland',
      url: 'https://secretlagoon.is/',
    },
    {
      position: 2,
      site_name: 'guidetoiceland.is',
      snippet: 'The Secret Lagoon is a man-made hot spring of natural resources located at Hverahólmi ...',
      title: 'Secret Lagoon Travel Guide',
      url: 'https://guidetoiceland.is/travel-iceland/drive/secret-lagoon',
    },
    {
      position: 3,
      site_name: 'www.tripadvisor.com',
      snippet: 'maintaining a temperature of 38-40 °C ...',
      title: 'Secret Lagoon - Gamla Laugin - All You SHOULD Know ...',
      url: 'https://www.tripadvisor.com/Attraction_Review-g608871-d6869489.html',
    },
  ],
});

/** An execFile stand-in that records its call and replays a canned result. */
function stubExec(result = { stdout: LIVE_CAPTURE }) {
  const calls = [];
  const impl = (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    const r = typeof result === 'function' ? result(calls.length) : result;
    queueMicrotask(() => cb(r.error ?? null, r.stdout ?? '', r.stderr ?? ''));
  };
  return { impl, calls };
}

const launcher = () => ({ file: '/usr/bin/node', prefix: ['/npx-cli.js'] });

function make(overrides = {}) {
  const { impl, calls } = stubExec(overrides.result);
  const search = createSearch({
    execFileImpl: impl,
    launcher,
    now: overrides.now,
    sleep: overrides.sleep,
    limit: overrides.limit,
    windowMs: overrides.windowMs,
  });
  return { search, calls };
}

test('a live capture parses to title, url and snippet', async () => {
  const { search } = make();
  const results = await search('Gamla Laugin Iceland water temperature');
  assert.equal(results.length, 3);
  assert.deepEqual(Object.keys(results[0]).sort(), ['snippet', 'title', 'url']);
  assert.equal(results[0].url, 'https://secretlagoon.is/');
  // Order is the ranking, and Step 3 walks it -- the official site is first.
  assert.deepEqual(
    results.map((r) => r.url.includes('secretlagoon.is')),
    [true, false, false],
  );
});

test('the query is an argv element, never a shell string', async () => {
  const { search, calls } = make();
  await search('Gamla Laugin " ; rm -rf / #');
  const { file, args, opts } = calls[0];
  // No shell anywhere: not requested, and the executable is a real binary.
  assert.equal(opts.shell, undefined);
  assert.equal(file, '/usr/bin/node');
  // The whole hostile string survives intact as ONE argument. If it had been
  // interpolated into a command line it would have been split or mangled here.
  const q = args[args.indexOf('query') + 1];
  assert.equal(q, 'Gamla Laugin " ; rm rf / #');
  assert.equal(args.filter((a) => a === q).length, 1);
});

test('a leading hyphen cannot smuggle a CLI option out of a spring name', () => {
  // The CLI parses options wherever they appear, so an interior token counts.
  assert.equal(sanitizeQuery('--include-domains=evil.test hot spring'), 'include-domains=evil.test hot spring');
  assert.equal(sanitizeQuery('Blue Lagoon --exclude-domains x'), 'Blue Lagoon exclude-domains x');
  assert.equal(sanitizeQuery('spa -quiet'), 'spa quiet');
  // Unicode dashes are option-shaped to nobody, but they are dash-shaped to a
  // search backend's exclusion syntax.
  assert.equal(sanitizeQuery('spa −quiet'), 'spa quiet');
  // A hyphen inside a token is part of a real name or number and stays.
  assert.equal(sanitizeQuery('Ma-ori 38-40 spring'), 'Ma-ori 38-40 spring');
});

test('an unusable query is refused before a process is spawned', async () => {
  const { search, calls } = make();
  await assert.rejects(() => search('   '), /empty/);
  await assert.rejects(() => search('---'), /empty/);
  await assert.rejects(() => search(42), TypeError);
  await assert.rejects(() => search('x'.repeat(301)), /300 characters/);
  assert.equal(calls.length, 0, 'nothing reached the process boundary');
});

test('--include-domains and --page are passed as separate argv elements', async () => {
  const { search, calls } = make();
  await search('Gamla Laugin', { includeDomains: ['secretlagoon.is', 'visiticeland.com'], page: 2 });
  const { args } = calls[0];
  assert.equal(args[args.indexOf('--include-domains') + 1], 'secretlagoon.is,visiticeland.com');
  assert.equal(args[args.indexOf('--page') + 1], '2');
  // --pretty would make us parse human-readable text; the default is JSON.
  assert.equal(args.includes('--pretty'), false);
});

test('an empty result set is a result, not a failure', async () => {
  const { search } = make({ result: { stdout: JSON.stringify({ query: 'x', results: [], total_results: 0 }) } });
  assert.deepEqual(await search('a spring nobody wrote about'), []);
});

test('missing auth is an actionable error, not an empty result', async () => {
  // Verbatim shape from the live CLI with a bad key: a JSON error object on
  // STDOUT, exit code 0. Trusting the exit code would have read as success and
  // then crashed on an absent results array.
  const stdout = JSON.stringify({
    error: 'Invalid or expired API key',
    status: 401,
    hint: 'Clear the TINYFISH_API_KEY environment variable, run `tinyfish auth login`, then try again.',
  });
  const { search } = make({ result: { stdout } });
  await assert.rejects(() => search('Gamla Laugin'), (err) => {
    assert.match(err.message, /Invalid or expired API key/);
    assert.match(err.message, new RegExp(AUTH_COMMAND.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&')));
    return true;
  });
});

test('a missing CLI is an actionable error, not a stack trace', async () => {
  const error = Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' });
  const { search } = make({ result: { error } });
  await assert.rejects(() => search('Gamla Laugin'), (err) => {
    assert.match(err.message, /ENOENT/);
    assert.match(err.message, /auth login/);
    return true;
  });
});

test('non-JSON output is an error naming the CLI, not a silent zero results', async () => {
  // What parsing `--pretty` would have to survive on every CLI release.
  const { search } = make({ result: { stdout: 'Query: x\nTotal results: 8\n\n1. Secret Lagoon\n' } });
  await assert.rejects(() => search('Gamla Laugin'), (err) => {
    assert.match(err.message, /not JSON/);
    assert.match(err.message, /auth login/);
    return true;
  });
});

test('a result without a usable url is dropped, and its neighbours survive', async () => {
  const stdout = JSON.stringify({
    results: [
      { title: 'no url here', snippet: 's' },
      { title: 'empty url', url: '', snippet: 's' },
      { url: 'https://secretlagoon.is/' },
    ],
  });
  const { search } = make({ result: { stdout } });
  const results = await search('Gamla Laugin');
  assert.deepEqual(results, [{ title: '', url: 'https://secretlagoon.is/', snippet: '' }]);
});

test('the throttle waits rather than exceeding the window', async () => {
  let clock = 0;
  const slept = [];
  const { search, calls } = make({
    limit: 2,
    windowMs: 60_000,
    now: () => clock,
    sleep: (ms) => {
      slept.push(ms);
      clock += ms;
      return Promise.resolve();
    },
  });

  await search('one');
  clock = 10_000;
  await search('two');
  assert.deepEqual(slept, [], 'two calls fit the window');

  // The third must not go out until the first has aged out: 50s of the
  // window remain, not a flat 60s, or the limiter would be a fixed cooldown.
  await search('three');
  assert.deepEqual(slept, [50_000], 'waited exactly until the oldest stamp expired');
  assert.equal(calls.length, 3);

  // And having waited, the window is genuinely re-checked, not just reset:
  // the second call's stamp (10s) is still inside it, so this waits 10s more.
  await search('four');
  assert.deepEqual(slept, [50_000, 10_000]);
});

test('concurrent callers cannot exceed the limit within one window', async () => {
  let clock = 0;
  // What the limiter actually promises is not "somebody slept" -- it is that
  // no window ever carries more than `limit` requests. Assert the issue times,
  // because an unserialised limiter still sleeps and still looks busy while
  // releasing two callers into the same window.
  const issuedAt = [];
  const search = createSearch({
    execFileImpl: (file, args, opts, cb) => {
      issuedAt.push(clock);
      queueMicrotask(() => cb(null, LIVE_CAPTURE, ''));
    },
    launcher,
    limit: 1,
    windowMs: 60_000,
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
  });

  // Fired together, so every caller reads the window before any of them writes
  // to it. A bare check-then-go limiter releases all three at once.
  await Promise.all([search('a'), search('b'), search('c')]);
  assert.deepEqual(issuedAt, [0, 60_000, 120_000], 'one request per window, in order');
});

test('the default ceiling is the free tier limit', () => {
  assert.equal(SEARCH_LIMIT_PER_MIN, 30);
});

test('the launcher runs npm\'s npx entry under node, never a .cmd', () => {
  // execFile refuses a .cmd with EINVAL unless shell:true -- which is the
  // boundary this module exists to avoid.
  const execPath = path.join('C:', 'Program Files', 'nodejs', 'node.exe');
  const wanted = path.join('C:', 'Program Files', 'nodejs', 'node_modules', 'npm', 'bin', 'npx-cli.js');
  const found = resolveLauncher({ execPath, exists: (p) => p === wanted });
  assert.equal(found.file, execPath);
  assert.deepEqual(found.prefix, [wanted]);
  assert.equal(found.prefix[0].endsWith('.cmd'), false);
});

test('a POSIX prefix layout resolves too', () => {
  const execPath = '/usr/local/bin/node';
  const wanted = path.join('/usr/local/bin', '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');
  const found = resolveLauncher({ execPath, exists: (p) => p === wanted });
  assert.deepEqual(found.prefix, [wanted]);
});
