/**
 * Shared transport for every vendor module.
 *
 * Calls go through Vercel AI Gateway, authenticated with a short-lived
 * project OIDC token rather than a long-lived provider secret. Adding a
 * vendor is still adding one file; this module is only the HTTP path they share.
 */
import fs from 'node:fs';

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

export const OIDC_HELP =
  'no AI Gateway credential found. Either works, set in .env.local (gitignored):\n' +
  '\n' +
  '  AI_GATEWAY_API_KEY=...   Long-lived. Create one in the Vercel dashboard\n' +
  '                           under AI Gateway > API keys. Preferred: it does\n' +
  '                           not expire partway through a run.\n' +
  '\n' +
  '  VERCEL_OIDC_TOKEN=...    Short-lived, about 12 hours. From this repo:\n' +
  '                             npx vercel login\n' +
  '                             npx vercel link\n' +
  '                             npx vercel env pull .env.local\n' +
  '                           Re-pull when it expires. The better choice in CI,\n' +
  '                           where a short-lived credential is the point.\n' +
  '\n' +
  'Enable AI Gateway for the linked project either way.';

/**
 * Bounded backoff for a rate-limited account.
 *
 * The first real run died on `Free tier requests on this model are
 * rate-limited`. Four retries at 2s, 4s, 8s, 16s waits out a per-minute
 * window without turning one throttled call into a stalled run.
 */
export const RATE_LIMIT_RETRIES = 4;
export const RATE_LIMIT_BASE_MS = 2_000;

/**
 * Distinct from every other gateway failure, and deliberately not turned into
 * a refutation anywhere.
 *
 * A rate limit is a fact about the account, not about the spring. Recorded as
 * a per-spring outcome it would poison the resume-skip: every spring the run
 * touched while throttled would be marked already-attempted and never tried
 * again -- the log asserting no sources exist when the truth is the account
 * was throttled. Ending the run costs nothing; the next run resumes here.
 */
export class RateLimitedError extends Error {
  constructor(model, detail) {
    super(
      `AI Gateway rate-limited ${model}, and the retries are exhausted: ${String(detail).slice(0, 300)}\n` +
        'This is a limit on the account, not a fact about any spring, so the run ends here ' +
        'rather than recording refutations. Wait for the window to reset and re-run; ' +
        'completed springs are skipped without spending.',
    );
    this.name = 'RateLimitedError';
    this.model = model;
  }
}

let envLoaded = false;

export function loadLocalEnv() {
  if (envLoaded) return;
  envLoaded = true;
  // First file loaded wins: Node's loadEnvFile does not overwrite existing keys.
  // Prefer .env.local (what `vercel env pull` writes) over .env.
  for (const file of ['.env.local', '.env']) {
    try {
      if (fs.existsSync(file)) process.loadEnvFile(file);
    } catch {
      // An unreadable env file is not a provider failure; the token check is.
    }
  }
}

/**
 * The gateway takes either credential in the same Bearer header.
 *
 * The API key is preferred because it does not expire. The OIDC token lasts
 * about twelve hours, and the failure it produces is bad: a run that has been
 * going for a while starts returning 401 on every call, which this codebase
 * correctly reports as `verifier-unavailable` rather than as refutations --
 * so nothing false is published, but a long run dies partway for a reason
 * that has nothing to do with the data. That happened while testing the model
 * layer, which is why the order here is what it is.
 *
 * OIDC remains supported and is the better choice in CI, where a short-lived
 * credential is the point.
 */
export function gatewayToken(env = process.env) {
  const token = env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN;
  if (!token) throw new Error(OIDC_HELP);
  return token;
}

/** Strip optional markdown fences and parse the first JSON object. */
export function parseJsonContent(text) {
  const trimmed = String(text).trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(unfenced.slice(start, end + 1));
    }
    throw new Error(`provider returned non-JSON: ${unfenced.slice(0, 200)}`);
  }
}

/**
 * `complete({ system, user, schema }) -> object`
 *
 * `schema` is enforced by asking for JSON and parsing it. The enrichment
 * schema uses additionalProperties for arbitrary field names, which strict
 * json_schema structured-output cannot express.
 */
export async function completeViaGateway(model, { system, user, schema }, options = {}) {
  if (!options.skipEnvFile) loadLocalEnv();
  const token = gatewayToken(options.env ?? process.env);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const retries = options.rateLimitRetries ?? RATE_LIMIT_RETRIES;
  const baseMs = options.rateLimitBaseMs ?? RATE_LIMIT_BASE_MS;

  const request = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: `${system}\n\nReply with JSON only, matching this schema:\n${JSON.stringify(schema)}`,
        },
        { role: 'user', content: user },
      ],
      stream: false,
      response_format: { type: 'json_object' },
    }),
  };

  let res;
  let text;
  for (let retry = 0; ; retry++) {
    res = await fetchImpl(GATEWAY_URL, request);
    text = await res.text();
    if (res.status !== 429) break;
    // Exhaustion throws rather than returning, so no caller can mistake a
    // throttled account for an answer about a spring.
    if (retry >= retries) throw new RateLimitedError(model, text);
    // Doubling, so a limiter that resets on a window boundary is waited out
    // rather than hammered at a fixed interval.
    await sleep(baseMs * 2 ** retry);
  }

  if (!res.ok) {
    throw new Error(`AI Gateway ${res.status} for ${model}: ${text.slice(0, 500)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`AI Gateway returned non-JSON for ${model}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`AI Gateway returned empty content for ${model}`);
  }
  return parseJsonContent(content);
}

/** Factory used by each vendor file: `(model) => ({ complete })`. */
export function createProvider(gatewayPrefix) {
  return (model, options) => ({
    complete: (input) => completeViaGateway(`${gatewayPrefix}/${model}`, input, options),
  });
}
