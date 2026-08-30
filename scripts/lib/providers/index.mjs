/**
 * Providers are pluggable and none is privileged.
 *
 * Every provider implements exactly:
 *
 *   complete({ system, user, schema }) -> object
 *
 * Anthropic, OpenAI, Google, xAI, or a local model are all just an
 * implementation of that. The atlas has no house model.
 */

/** `vendor:model` -> `vendor`. */
export function vendorOf(id) {
  // Lowercased, or "OpenAI:gpt-5" and "openai:gpt-5" read as two providers
  // while resolving to the same module on Windows and macOS -- turning the
  // one hard rule into self-review without any error.
  return String(id).toLowerCase().split(':')[0];
}

/**
 * The one hard rule.
 *
 * Two models from the same vendor are the same provider for this purpose:
 * they share training data, tokeniser, and failure modes, so one refuting the
 * other is nearly as circular as a model refuting itself. This is why N-way
 * agreement was rejected -- correlated error is not evidence.
 */
const VENDOR = /^[a-z0-9-]+$/;

export function resolveRoles(config) {
  for (const role of ['proposer', 'verifier']) {
    if (!config?.[role]) {
      throw new Error(
        `enrichment requires a ${role}; configure one in enrichment.config.json`,
      );
    }
    if (!VENDOR.test(vendorOf(config[role]))) {
      // vendorOf feeds a dynamic import path. This repo path-guards anything
      // that reaches a filesystem lookup; config is no exception.
      throw new Error(`vendor in ${role} must match ${VENDOR}, got ${JSON.stringify(config[role])}`);
    }
  }
  if (vendorOf(config.proposer) === vendorOf(config.verifier)) {
    throw new Error(
      `proposer and verifier must be different providers, got ${config.proposer} and ${config.verifier}. ` +
        'A model refuting its own claim is not verification.',
    );
  }
  return { proposer: config.proposer, verifier: config.verifier };
}
