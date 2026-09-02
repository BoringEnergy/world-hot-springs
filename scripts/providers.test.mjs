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

test('a missing OIDC token explains how to get one, rather than asking for an API key', () => {
  assert.throws(() => gatewayToken({}), (err) => {
    assert.equal(err.message, OIDC_HELP);
    assert.match(err.message, /OIDC/);
    assert.doesNotMatch(err.message, /API_KEY/);
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

test('vendor modules do not read provider API keys', () => {
  const dir = path.join('scripts', 'lib', 'providers');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  const banned = /OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|XAI_API_KEY|AI_GATEWAY_API_KEY/;
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!banned.test(src), `${f} mentions a provider API key`);
  }
});
