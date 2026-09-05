/**
 * Bring contributor files into the runner without letting them choose where.
 *
 * Rule 3 of the security spec, and the fix for finding F1. The rule did not
 * exist in the spec's first draft, and its absence was the hole: a pull
 * request containing `scripts/ci/manager.mjs`, fetched to its repo-relative
 * path, would overwrite the trusted script that the next step runs with an
 * API key in scope.
 *
 * So the filename is derived from the CONTENT, never from anything the
 * contributor supplied. `f.filename` is attacker-controlled text and is used
 * only as a label in output, never as a path component. The destination is a
 * directory this process created under $RUNNER_TEMP, never the checkout.
 *
 * The byte cap rejects rather than truncates. Truncation lets whoever wrote
 * the file choose where the evidence stops, which is an injection primitive
 * rather than a size control -- the same reasoning as verify-source.mjs, and
 * finding F4: `data/overlay/*.json` is attacker-written and can be megabytes
 * of perfectly valid JSON.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * One overlay file is a handful of claims. Anything approaching this is not a
 * data correction, and a pre-call token count would reject it anyway -- this
 * just refuses to pay for the download first.
 */
export const MAX_CONTRIB_BYTES = 256 * 1024;

/**
 * @returns {Promise<{ok: true, files: Array<{label: string, path: string, sha256: string, text: string}>}
 *                  | {ok: false, reason: string}>}
 */
export async function fetchContributorFiles(entries, { dir, fetchImpl = fetch } = {}) {
  if (!dir) return { ok: false, reason: 'a destination directory is required' };
  const resolved = path.resolve(dir);
  const files = [];

  for (const entry of entries) {
    let res;
    try {
      res = await fetchImpl(entry.raw_url);
    } catch (err) {
      return { ok: false, reason: `could not fetch ${entry.filename}: ${err.message}` };
    }
    if (!res.ok) {
      return { ok: false, reason: `could not fetch ${entry.filename}: HTTP ${res.status}` };
    }

    // Reject on the declared length before reading a byte, then again on what
    // actually arrived: a hostile host lies about content-length, or omits it
    // and streams.
    const declared = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > MAX_CONTRIB_BYTES) {
      return { ok: false, reason: `${entry.filename} declares ${declared} bytes, cap is ${MAX_CONTRIB_BYTES}` };
    }
    const text = await res.text();
    const size = Buffer.byteLength(text, 'utf8');
    if (size > MAX_CONTRIB_BYTES) {
      return { ok: false, reason: `${entry.filename} is ${size} bytes, cap is ${MAX_CONTRIB_BYTES}` };
    }

    // The whole point: the name comes from the bytes.
    const sha256 = crypto.createHash('sha256').update(text).digest('hex');
    const dest = path.join(resolved, `${sha256}.json`);

    // Defence in depth. sha256 is hex so it cannot escape, but a future change
    // to the naming scheme must not silently become a path traversal.
    if (path.dirname(path.resolve(dest)) !== resolved) {
      return { ok: false, reason: `refusing to write outside ${resolved}` };
    }

    fs.writeFileSync(dest, text);
    files.push({ label: entry.filename, path: dest, sha256, text });
  }

  return { ok: true, files };
}
