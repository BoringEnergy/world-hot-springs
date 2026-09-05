/**
 * Gate 2 -- the check that counts.
 *
 * Gate 1 runs from the pull request's own copy of the workflow, so on a fork
 * a contributor can rewrite it to report success on anything. Its green tick
 * is contributor feedback and worth nothing as a security input. This runs
 * from the default branch under `workflow_run`, which is the one property
 * `pull_request_target` cannot give: the reviewing code cannot be edited by
 * the thing being reviewed.
 *
 * ## No API key, deliberately
 *
 * The spec's design ends in a model call holding ANTHROPIC_API_KEY. That step
 * is not built yet, and its absence is what makes everything here safe:
 *
 *   - The residual SSRF in source-url.mjs (DNS rebinding between resolve and
 *     connect) is a way to make this job talk to a private address. With no
 *     secret in scope, the worst it reaches is an empty runner.
 *   - Rule 3's hole (F1) was contributor files overwriting trusted scripts
 *     before the key-bearing step. There is no key-bearing step.
 *
 * Do not add a secret to this workflow without first building the missing
 * pieces the spec names: assert-checkout-pristine, the content-hash fetch
 * into $RUNNER_TEMP, and the eligibility/budget checks.
 *
 * ## What it does
 *
 * Re-derives every security-relevant fact from the API rather than from Gate
 * 1's output (rule 5), path-guards the API-derived file list BEFORE fetching
 * anything (rule 4), then re-runs the deterministic gates from this
 * checkout's code (rule 6): shape validation, and -- new -- whether each
 * numeric claim is actually supported by the page it cites.
 *
 * Exit codes: 0 accept, 1 reject, 2 undecided (a source could not be read).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePr, checkFileListUsable } from './lib/resolve-pr.mjs';
import { checkPaths } from '../lib/pathguard.mjs';
import { validateOverlay } from '../lib/overlay.mjs';
import { verifyClaims, summarise, VERDICT } from '../lib/verify-claims.mjs';

const API = 'https://api.github.com';

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function api(url, token) {
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Refuse and say why. Never a silent pass. */
function refuse(reason) {
  console.error(`gate-2: REFUSED -- ${reason}`);
  return 1;
}

async function main() {
  const repo = env('GITHUB_REPOSITORY');
  const token = env('GH_TOKEN');
  const headSha = env('HEAD_SHA');
  const headRepo = env('HEAD_REPO');

  // Rule 5: re-derive from the API. Gate 1's artifact is attacker-shaped.
  const resolved = await resolvePr({
    headSha,
    headRepo,
    listPulls: () => api(`${API}/repos/${repo}/commits/${headSha}/pulls`, token),
  });
  if (!resolved.ok) return refuse(resolved.reason);
  console.log(`gate-2: reviewing PR #${resolved.number} at ${headSha}`);

  const filesRaw = await api(
    `${API}/repos/${repo}/pulls/${resolved.number}/files?per_page=100`,
    token,
  );
  const names = filesRaw.map((f) => f.filename);

  // A pull request from this repository came from someone who already has
  // write access. The path guard exists to stop a STRANGER editing the
  // pipeline that reviews them; applied to a maintainer it refuses every
  // ordinary change to src/ or scripts/ -- which is exactly what it did on
  // this gate's first live run, against the pull request adding minerals.
  //
  // Determined from the head repository, not a label or the author's name: a
  // fork's full_name cannot be spoofed by the contributor, and it is the same
  // fact GitHub uses to decide whether to expose secrets.
  const isFork = headRepo !== repo;
  console.log(`gate-2: head repo ${headRepo} (${isFork ? 'fork' : 'same repo'})`);

  // The API cap check is not part of that scoping: it asks whether the list
  // can be seen in full, which is a question about the response rather than
  // about who sent it.
  const usable = checkFileListUsable(names, { enforceCountLimit: isFork });
  if (!usable.ok) return refuse(usable.reason);

  if (isFork) {
    // Rule 4: guard the paths BEFORE fetching a byte of contributor content.
    // In the spec's first draft this ran after the fetch, and that ordering
    // was the hole.
    const pathErrors = checkPaths(names);
    if (pathErrors.length) return refuse(`path guard:\n  ${pathErrors.join('\n  ')}`);
  } else {
    console.log('gate-2: same-repo change, path guard not applied. Claims are still verified.');
  }

  const overlayFiles = filesRaw.filter(
    (f) => f.filename.startsWith('data/overlay/') && f.status !== 'removed',
  );
  if (overlayFiles.length === 0) {
    console.log('gate-2: no overlay claims in this pull request. Nothing to verify.');
    return 0;
  }

  // Rule 3: contributor content goes to a temp directory named by us, never
  // to a path the contributor chose, and never inside this checkout.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gate2-'));
  const parsed = [];
  for (const f of overlayFiles) {
    const raw = await (await fetch(f.raw_url)).text();
    // Named by index, not by f.filename: the name is attacker-supplied text.
    fs.writeFileSync(path.join(scratch, `${parsed.length}.json`), raw);
    try {
      parsed.push({ name: f.filename, overlay: JSON.parse(raw) });
    } catch (err) {
      return refuse(`${f.filename} is not valid JSON: ${err.message}`);
    }
  }

  // Rule 6: re-run the deterministic gates from THIS checkout's code.
  const shapeErrors = [];
  for (const { name, overlay } of parsed) {
    for (const e of validateOverlay(overlay, { agentAuthored: true })) {
      shapeErrors.push(`${name}: ${e}`);
    }
  }
  if (shapeErrors.length) return refuse(`validation:\n  ${shapeErrors.join('\n  ')}`);

  // The new check: is the claim true according to the page it cites?
  const results = [];
  for (const { name, overlay } of parsed) {
    for (const r of await verifyClaims(overlay)) results.push({ name, ...r });
  }
  const { counts, code } = summarise(results);

  for (const r of results) {
    if (r.verdict === VERDICT.VERIFIED) continue;
    console.log(`gate-2: ${r.verdict.toUpperCase()} ${r.name} ${r.field}${r.detail ? ` (${r.detail})` : ''}`);
  }
  console.log(
    `gate-2: ${counts.verified} verified, ${counts.refuted} refuted, ` +
      `${counts.unreachable} unreachable, ${counts.needsReview} need a reader.`,
  );
  if (code === 1) console.error('gate-2: REFUSED -- a claim is contradicted by its own source.');
  if (code === 2) console.error('gate-2: UNDECIDED -- a source could not be read. Safe to re-run.');
  return code;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    // An exception in a privileged workflow must not read as a pass.
    console.error(`gate-2: FAILED CLOSED -- ${err.message}`);
    process.exit(1);
  },
);
