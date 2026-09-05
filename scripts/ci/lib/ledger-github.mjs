/**
 * The durable ledger, stored as one file in this repository.
 *
 * Finding F8 required naming the store. This is the name:
 *
 *   branch  gate-2-ledger      an orphan branch, no shared history with main
 *   file    ledger.json        the only path the App token needs to write
 *
 * An orphan branch because the ledger must not reach the site build, must not
 * appear in a diff anyone reviews, and must not be rewritten by a rebase of
 * main. It shares no commits with main, so nothing about it can affect what
 * gets published.
 *
 * One file because the App token's scope is the security property. A token
 * that can write `gate-2-ledger:ledger.json` and nothing else cannot touch
 * source, workflows, or data even if the privileged step is compromised.
 *
 * ## Compare-and-swap, not last-write-wins
 *
 * Two runs can be in flight at once -- the concurrency group covers one head
 * SHA, not the repository. Reading, mutating and writing without a guard
 * loses whichever write lands first, and a lost write is a budget that
 * silently forgets a review. That is the exact failure F8 rejected the
 * Actions cache for, reintroduced from a different direction.
 *
 * GitHub's contents API gives the primitive for free: a PUT carrying the blob
 * `sha` we read is rejected with 409 if the file changed underneath. So the
 * sha is the CAS token, and a conflict retries the whole read-modify-write
 * rather than forcing the stale value.
 */

const API = 'https://api.github.com';

export const LEDGER_BRANCH = 'gate-2-ledger';
export const LEDGER_PATH = 'ledger.json';

/** How many times to re-read and retry after a concurrent write. */
export const CAS_RETRIES = 5;

/**
 * Entries older than this are dropped on write.
 *
 * The caps are daily, so nothing older than a day is ever consulted. Keeping
 * a week is slack for clock skew and for reading a run's history when
 * something looks wrong; keeping forever would grow one JSON file until the
 * API refused it, and the failure would arrive as a mysterious 4xx during an
 * incident rather than as a design decision.
 */
export const RETENTION_DAYS = 7;

function headers(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  };
}

/**
 * @param {object} cfg
 * @param {string} cfg.repo    owner/name
 * @param {string} cfg.token   an App installation token scoped to LEDGER_PATH
 * @param {typeof fetch} [cfg.fetchImpl]
 * @param {() => Date} [cfg.now]
 */
export function githubLedger({ repo, token, fetchImpl = fetch, now = () => new Date() }) {
  const url = `${API}/repos/${repo}/contents/${LEDGER_PATH}?ref=${LEDGER_BRANCH}`;

  async function read() {
    const res = await fetchImpl(url, { headers: headers(token) });
    // A ledger that does not exist yet is an empty ledger, not an error --
    // the first run must be able to create it.
    if (res.status === 404) return { entries: {}, sha: null };
    if (!res.ok) throw new Error(`ledger read failed: HTTP ${res.status}`);
    const body = await res.json();
    const text = Buffer.from(body.content ?? '', 'base64').toString('utf8');
    let entries;
    try {
      entries = JSON.parse(text);
    } catch {
      // Refuse rather than reset. A corrupt ledger silently replaced by an
      // empty one is a budget reset, which is the attack F8 names.
      throw new Error('ledger is not valid JSON; refusing to overwrite it');
    }
    return { entries, sha: body.sha };
  }

  async function write(entries, sha, message) {
    const res = await fetchImpl(`${API}/repos/${repo}/contents/${LEDGER_PATH}`, {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({
        message,
        branch: LEDGER_BRANCH,
        content: Buffer.from(`${JSON.stringify(entries, null, 2)}\n`, 'utf8').toString('base64'),
        // Absent for a create; present and checked for an update. This is the
        // compare-and-swap.
        ...(sha ? { sha } : {}),
      }),
    });
    if (res.status === 409 || res.status === 422) return false; // someone else wrote
    if (!res.ok) throw new Error(`ledger write failed: HTTP ${res.status}`);
    return true;
  }

  function prune(entries) {
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    const kept = {};
    for (const [k, v] of Object.entries(entries)) {
      if (v?.at && new Date(v.at).getTime() >= cutoff) kept[k] = v;
    }
    return kept;
  }

  return {
    async get(key) {
      const { entries } = await read();
      return entries[key] ?? null;
    },

    /**
     * Sums CLAIMS, not rows.
     *
     * Claims are the billable unit: one pull request may carry 650 of them,
     * so counting rows would budget in reviews and be wrong by two orders of
     * magnitude -- the mistake the caps in eligibility.mjs were built to fix.
     */
    async countSince(prefix, since) {
      const { entries } = await read();
      let n = 0;
      for (const [k, v] of Object.entries(entries)) {
        if (k.startsWith(prefix) && v?.at && new Date(v.at) >= since) n += v.claims ?? 0;
      }
      return n;
    },

    async put(key, value) {
      for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
        const { entries, sha } = await read();
        const next = prune({ ...entries, [key]: { at: now().toISOString(), ...value } });
        if (await write(next, sha, `gate-2: record ${key}`)) return;
      }
      // Loud. A silently dropped write is a budget that forgets, and the
      // caller must be able to fail closed rather than proceed.
      throw new Error(`ledger write lost ${CAS_RETRIES} races for ${key}`);
    },
  };
}
