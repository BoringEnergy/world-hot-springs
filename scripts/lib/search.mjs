/**
 * Find candidate source URLs for a spring.
 *
 * The proposer used to be asked to recall a citation from memory; it declined,
 * every time, which was the model behaving well against a design that could not
 * work. This module supplies the URL instead, so the proposer's job becomes
 * extraction from text we retrieved rather than recall.
 *
 * Search only. Retrieval stays with `fetchSource`, which owns the byte cap, the
 * scheme guard, the timeout and the outcome enum -- handing that to a third
 * party would move a security boundary out of this repository for no gain.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Free-tier ceiling on the search endpoint. Fetch is a separate, larger pool. */
export const SEARCH_LIMIT_PER_MIN = 30;

/** Named in every actionable failure, because it is the fix for most of them. */
export const AUTH_COMMAND = 'npx @tiny-fish/cli auth login';

/**
 * A query longer than this is a dataset defect, not a search. The cap keeps a
 * pathological `name` out of the process argument block.
 */
const MAX_QUERY_LENGTH = 300;

/**
 * Resolve a way to run `npx` with NO shell.
 *
 * On Windows `npx` is `npx.cmd`, and since Node's batch-file fix `execFile`
 * refuses a `.cmd` outright (EINVAL) unless `shell: true` -- which is exactly
 * the string-interpolation boundary this module exists to avoid. Running npm's
 * own `npx-cli.js` under `process.execPath` sidesteps both: a real executable,
 * and an argv array the OS never re-parses.
 */
export function resolveLauncher({ execPath = process.execPath, exists = existsSync } = {}) {
  const dir = path.dirname(execPath);
  const candidates = [
    // Windows / official installer layout.
    path.join(dir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    // POSIX prefix layout: bin/node alongside lib/node_modules.
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ];
  for (const js of candidates) {
    if (exists(js)) return { file: execPath, prefix: [js] };
  }
  // No npm beside this node. `npx` on PATH is not a .cmd off Windows, so it is
  // still safe to exec directly; on Windows it would be, so refuse instead.
  if (process.platform === 'win32') {
    throw new Error(
      `could not locate npx-cli.js next to ${execPath}; install the TinyFish CLI and run \`${AUTH_COMMAND}\``,
    );
  }
  return { file: 'npx', prefix: [] };
}

/**
 * Strip option-looking tokens from a query.
 *
 * The query carries a spring `name` from the dataset, which is
 * contributor-influenced text. It is passed as an argv element, so no shell
 * ever sees it -- but the CLI's own parser reads `--include-domains` wherever
 * it appears, not only in first position. A leading hyphen also means
 * "exclude" to the search backend. Neither is a decision contributor text gets
 * to make, and a hyphen inside a token ("38-40", "Ma-ori") is untouched.
 */
export function sanitizeQuery(value) {
  if (typeof value !== 'string') throw new TypeError('search query must be a string');
  const cleaned = value.replace(/(^|\s)[-−–]+/g, '$1').replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('search query is empty');
  if (cleaned.length > MAX_QUERY_LENGTH) {
    throw new Error(`search query exceeds ${MAX_QUERY_LENGTH} characters`);
  }
  return cleaned;
}

/**
 * Serialised sliding-window limiter.
 *
 * The gate is a promise chain rather than a bare check: concurrent callers
 * reading the same window would all see room and all pass, which is how a
 * "throttle" ships green and still trips the limit on the first parallel run.
 */
function createThrottle({ limit, windowMs, now, sleep }) {
  const stamps = [];
  let gate = Promise.resolve();
  return function acquire() {
    const mine = gate.then(async () => {
      for (;;) {
        const t = now();
        while (stamps.length > 0 && t - stamps[0] >= windowMs) stamps.shift();
        if (stamps.length < limit) {
          stamps.push(t);
          return;
        }
        await sleep(windowMs - (t - stamps[0]));
      }
    });
    // A rejected acquire must not wedge every later caller behind it.
    gate = mine.then(
      () => undefined,
      () => undefined,
    );
    return mine;
  };
}

/**
 * Build a search function.
 *
 * Everything at the process boundary is injectable so the parser, the throttle
 * and the failure branches are testable without touching a rate-limited shared
 * service.
 */
export function createSearch({
  execFileImpl = execFile,
  launcher,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  limit = SEARCH_LIMIT_PER_MIN,
  windowMs = 60_000,
  timeoutMs = 60_000,
} = {}) {
  const acquire = createThrottle({ limit, windowMs, now, sleep });

  return async function search(query, { includeDomains, page } = {}) {
    const cleaned = sanitizeQuery(query);

    // No `--pretty`: the CLI's default output is JSON, and parsing the
    // human-readable rendering would make a cosmetic release a silent
    // zero-results run.
    const args = ['search', 'query', cleaned];
    if (Array.isArray(includeDomains) && includeDomains.length > 0) {
      args.push('--include-domains', includeDomains.join(','));
    }
    if (page != null) args.push('--page', String(page));

    const { file, prefix } = (launcher ?? resolveLauncher)();

    await acquire();

    const { error, stdout } = await new Promise((resolve) => {
      execFileImpl(
        file,
        [...prefix, '-y', '@tiny-fish/cli', ...args],
        { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (err, out, errOut) => resolve({ error: err, stdout: out ?? '', stderr: errOut ?? '' }),
      );
    });

    // A CLI that is absent, unlaunchable or killed produced no answer at all.
    // Saying so is the whole point: a broken install must never read as "this
    // spring has no sources".
    if (error) {
      throw new Error(
        `TinyFish search could not run (${error.code ?? error.message}). ` +
          `Install and authenticate the CLI: \`${AUTH_COMMAND}\``,
      );
    }

    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch {
      throw new Error(
        `TinyFish search returned output that is not JSON: ${stdout.slice(0, 200)}. ` +
          `Check the CLI: \`${AUTH_COMMAND}\``,
      );
    }

    // Auth failure arrives as a JSON error object on stdout with exit code 0,
    // so the exit code cannot be trusted to tell a bad key from a good answer.
    if (!payload || !Array.isArray(payload.results)) {
      const detail = payload?.error ?? 'no results array in response';
      throw new Error(`TinyFish search failed: ${detail}. Run \`${AUTH_COMMAND}\``);
    }

    return payload.results
      .filter((r) => r && typeof r.url === 'string' && r.url !== '')
      .map((r) => ({
        title: typeof r.title === 'string' ? r.title : '',
        url: r.url,
        snippet: typeof r.snippet === 'string' ? r.snippet : '',
      }));
  };
}

/** The process-wide client. One throttle, so the 30/min ceiling is real. */
export const search = createSearch();
