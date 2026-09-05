import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveRoles, loadProviders } from './lib/providers/index.mjs';
import {
  OIDC_HELP,
  completeViaGateway,
  gatewayToken,
  parseJsonContent,
  RateLimitedError,
  RATE_LIMIT_RETRIES,
} from './lib/providers/gateway.mjs';

const two = { proposer: 'openai:gpt-5', verifier: 'anthropic:claude-opus-5' };

test('two distinct providers resolve', () => {
  const roles = resolveRoles(two);
  assert.equal(roles.proposer, 'openai:gpt-5');
  assert.equal(roles.verifier, 'anthropic:claude-opus-5');
});

test('the same provider in both roles is refused, not warned about', () => {
  // A model refuting its own claim is theatre, and it is the entire reason
  // multi-provider is worth its complexity.
  assert.throws(
    () => resolveRoles({ proposer: 'openai:gpt-5', verifier: 'openai:gpt-5' }),
    /must be different providers/,
  );
});

test('two models from one vendor are still the same provider', () => {
  assert.throws(
    () => resolveRoles({ proposer: 'openai:gpt-5', verifier: 'openai:gpt-5-mini' }),
    /must be different providers/,
  );
});

test('vendor comparison is case-insensitive', () => {
  // Otherwise "OpenAI:gpt-5" vs "openai:gpt-5" passes the distinctness rule
  // and then resolves to the same file on a case-insensitive filesystem --
  // self-review, reported as verification.
  assert.throws(
    () => resolveRoles({ proposer: 'OpenAI:gpt-5', verifier: 'openai:gpt-5' }),
    /must be different providers/,
  );
});

test('a vendor name that is not a plain identifier is refused', () => {
  // vendorOf feeds a dynamic import path.
  assert.throws(() => resolveRoles({ proposer: '../../evil:x', verifier: 'openai:gpt-5' }), /vendor/i);
});

test('a missing role fails with an explanation', () => {
  assert.throws(() => resolveRoles({ proposer: 'openai:gpt-5' }), /verifier/);
});

test('no provider is privileged by the interface', () => {
  // Any vendor pair is acceptable; the code must hold no opinion about which.
  // Asserting the returned value here and not only in the openai/anthropic
  // test is what stops resolveRoles being a constant: with a single happy-path
  // assertion whose input is exactly the expected output, a hardcoded return
  // passed all seven tests.
  const roles = resolveRoles({ proposer: 'google:gemini-3', verifier: 'xai:grok-4' });
  assert.equal(roles.proposer, 'google:gemini-3');
  assert.equal(roles.verifier, 'xai:grok-4');
});

test('the ids come back as given, only the comparison is lowercased', () => {
  const roles = resolveRoles({ proposer: 'Google:Gemini-3', verifier: 'xai:grok-4' });
  assert.equal(roles.proposer, 'Google:Gemini-3');
});

const SCHEMA = { type: 'object', required: ['claims'], properties: { claims: { type: 'object' } } };
const INPUT = { system: 'return claims', user: '{}', schema: SCHEMA };
const TOKEN = 'oidc-test-token-do-not-leak';

function jsonResponse(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('either gateway credential authenticates, and the key wins', () => {
  // Both go in the same Bearer header. The API key is preferred because it
  // does not expire: a 12-hour OIDC token dying mid-run turns every call into
  // a 401, which this codebase reports as verifier-unavailable rather than as
  // refutations -- nothing false is published, but a long run ends for a
  // reason unrelated to the data. That happened while testing the model
  // layer, which is why the order is this way round.
  assert.equal(gatewayToken({ AI_GATEWAY_API_KEY: 'k' }), 'k');
  assert.equal(gatewayToken({ VERCEL_OIDC_TOKEN: 'o' }), 'o');
  assert.equal(gatewayToken({ AI_GATEWAY_API_KEY: 'k', VERCEL_OIDC_TOKEN: 'o' }), 'k');
});

test('a missing credential explains both ways to supply one', () => {
  assert.throws(() => gatewayToken({}), (err) => {
    assert.equal(err.message, OIDC_HELP);
    // Names both, so someone holding either credential is not told to go and
    // get the other one.
    assert.match(err.message, /AI_GATEWAY_API_KEY/);
    assert.match(err.message, /VERCEL_OIDC_TOKEN/);
    assert.match(err.message, /env\.local/);
    // The old assertion here was `doesNotMatch(/API_KEY/)`, from when the
    // design was OIDC-only and the help text existed to stop people hunting
    // for a provider key. Supporting the gateway's own API key makes that
    // assertion wrong rather than merely stale, so it is removed rather than
    // relaxed. Per-vendor keys are still forbidden, by the two tests above.
    return true;
  });
});

test('completeViaGateway parses a structured JSON reply', async () => {
  const fetchImpl = async () => jsonResponse({
    choices: [{ message: { content: '{"claims":{"temperature.celsius":{"value":38,"source":"https://e.org"}}}' } }],
  });
  const result = await completeViaGateway('openai/gpt-5.6-sol', INPUT, {
    fetchImpl, env: { VERCEL_OIDC_TOKEN: TOKEN }, skipEnvFile: true,
  });
  assert.equal(result.claims['temperature.celsius'].value, 38);
});

test('completeViaGateway parses JSON wrapped in a markdown fence', async () => {
  const fetchImpl = async () => jsonResponse({
    choices: [{ message: { content: '```json\n{"claims":{}}\n```' } }],
  });
  const result = await completeViaGateway('anthropic/claude-opus-5', INPUT, {
    fetchImpl, env: { VERCEL_OIDC_TOKEN: TOKEN }, skipEnvFile: true,
  });
  assert.deepEqual(result, { claims: {} });
});

test('a gateway error does not echo the OIDC token', async () => {
  const fetchImpl = async () => jsonResponse('unauthorized', 401);
  await assert.rejects(
    () => completeViaGateway('google/gemini-3.7-flash', INPUT, {
      fetchImpl, env: { VERCEL_OIDC_TOKEN: TOKEN }, skipEnvFile: true,
    }),
    (err) => {
      assert.match(err.message, /401/);
      assert.doesNotMatch(err.message, new RegExp(TOKEN));
      return true;
    },
  );
});

test('a 429 is retried, and the wait doubles between attempts', async () => {
  // The first real run died on `Free tier requests on this model are
  // rate-limited`. Asserting only "it retried" would pass against a fixed
  // 0 ms loop, which is a hammer, not a backoff -- so the waits themselves
  // are the assertion.
  const slept = [];
  let call = 0;
  const fetchImpl = async () => {
    call++;
    return call <= 3
      ? jsonResponse('Free tier requests on this model are rate-limited', 429)
      : jsonResponse({ choices: [{ message: { content: '{"claims":{}}' } }] });
  };
  const result = await completeViaGateway('spacexai/grok-4.1-fast-non-reasoning', INPUT, {
    fetchImpl, env: { VERCEL_OIDC_TOKEN: TOKEN }, skipEnvFile: true,
    sleep: async (ms) => { slept.push(ms); }, rateLimitBaseMs: 1000,
  });
  assert.deepEqual(result, { claims: {} });
  assert.equal(call, 4, 'three throttled calls and one that answered');
  assert.deepEqual(slept, [1000, 2000, 4000], 'each wait must be twice the last');
});

test('exhausted 429 retries throw a RateLimitedError naming the account, not the spring', async () => {
  // The failure this prevents is subtle and expensive: recorded as a per-spring
  // outcome, a throttled window marks every spring it touched as hopeless and
  // the resume-skip never tries them again.
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonResponse('rate-limited', 429); };
  await assert.rejects(
    () => completeViaGateway('spacexai/grok-4.1-fast-non-reasoning', INPUT, {
      fetchImpl, env: { VERCEL_OIDC_TOKEN: TOKEN }, skipEnvFile: true,
      sleep: async () => {}, rateLimitRetries: 2,
    }),
    (err) => {
      assert.ok(err instanceof RateLimitedError, `got ${err.name}`);
      assert.match(err.message, /limit on the account, not a fact about any spring/);
      return true;
    },
  );
  assert.equal(calls, 3, 'the original call plus exactly two retries');
});

test('the retry budget is bounded, and is not the same number as a success', async () => {
  // A default of Infinity would hang the run rather than end it; a default of
  // 0 would make the backoff decorative.
  assert.ok(Number.isInteger(RATE_LIMIT_RETRIES) && RATE_LIMIT_RETRIES > 0);
  assert.ok(RATE_LIMIT_RETRIES < 10, 'a long ladder stalls the run instead of ending it');
});

test('a non-429 error is not retried', async () => {
  // Backing off a 401 just delays the message that says the token expired.
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonResponse('unauthorized', 401); };
  await assert.rejects(() => completeViaGateway('openai/gpt-5.6-sol', INPUT, {
    fetchImpl, env: { VERCEL_OIDC_TOKEN: TOKEN }, skipEnvFile: true,
    sleep: async () => {},
  }), /401/);
  assert.equal(calls, 1);
});

test('non-JSON content is a parse failure', () => {
  assert.throws(() => parseJsonContent('not json at all'), /non-JSON/);
});

test('loadProviders loads two real vendor modules', async () => {
  const providers = await loadProviders({
    proposer: 'xai:grok-4.6',
    verifier: 'anthropic:claude-opus-5',
  });
  assert.equal(typeof providers.proposer.complete, 'function');
  assert.equal(typeof providers.verifier.complete, 'function');
});

test('each vendor sends the gateway model id for its lab', async () => {
  const expected = {
    openai: 'openai/gpt-5.6-sol',
    anthropic: 'anthropic/claude-opus-5',
    google: 'google/gemini-3.7-flash',
    xai: 'spacexai/grok-4.6',
  };
  const models = {
    openai: 'gpt-5.6-sol',
    anthropic: 'claude-opus-5',
    google: 'gemini-3.7-flash',
    xai: 'grok-4.6',
  };
  for (const vendor of Object.keys(expected)) {
    let captured;
    const fetchImpl = async (_url, init) => {
      captured = JSON.parse(init.body);
      return jsonResponse({ choices: [{ message: { content: '{"claims":{}}' } }] });
    };
    const factory = (await import(`./lib/providers/${vendor}.mjs`)).default;
    const provider = factory(models[vendor], {
      fetchImpl, env: { VERCEL_OIDC_TOKEN: TOKEN }, skipEnvFile: true,
    });
    await provider.complete(INPUT);
    assert.equal(captured.model, expected[vendor], vendor);
  }
});

test('no module reads a per-vendor API key', () => {
  // The rule is one credential path. A vendor module reaching for
  // OPENAI_API_KEY would route around the gateway, and the whole
  // vendor-agnostic design with it.
  const dir = path.join('scripts', 'lib', 'providers');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  const perVendor = /OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|XAI_API_KEY/;
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!perVendor.test(src), `${f} mentions a per-vendor API key`);
  }
});

test('only gateway.mjs may name the gateway credential', () => {
  // AI_GATEWAY_API_KEY was originally banned alongside the per-vendor keys,
  // when the design was OIDC-only. It is not a provider key: it authenticates
  // the same gateway the OIDC token does, in the same Bearer header, and
  // supporting it keeps exactly one credential path rather than adding one.
  //
  // The rule it was really protecting -- vendor modules must not authenticate
  // for themselves -- is preserved by scoping it to the one file that owns
  // the gateway. A vendor module naming it would be routing around
  // completeViaGateway, which is the thing worth forbidding.
  const dir = path.join('scripts', 'lib', 'providers');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (f === 'gateway.mjs') continue;
    assert.ok(!/AI_GATEWAY_API_KEY/.test(src), `${f} must not read the gateway credential itself`);
  }
});
