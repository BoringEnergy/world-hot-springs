import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoles } from './lib/providers/index.mjs';

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
