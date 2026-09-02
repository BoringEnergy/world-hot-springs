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
  'enrichment authenticates with a short-lived Vercel OIDC token, not provider API keys.\n' +
  'From this repo:\n' +
  '  npx vercel login\n' +
  '  npx vercel link\n' +
  '  npx vercel env pull .env.local\n' +
  'Enable AI Gateway for the linked project. Tokens last about 12 hours; re-run env pull when they expire.';

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

export function gatewayToken(env = process.env) {
  const token = env.VERCEL_OIDC_TOKEN;
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

  const res = await fetchImpl(GATEWAY_URL, {
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
  });

  const text = await res.text();
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
