/**
 * Produce the atlas's first authored claims.
 *
 * Runs locally on the operator's own credential. That is not a convenience --
 * it means no secret exists in the repository, no maintainer carries the
 * spend, and there is no CI trigger to secure. The output is overlay JSON,
 * which gate-1 already validates.
 *
 * Usage:
 *   node scripts/enrich.mjs --dry-run              # plan only, no calls
 *   node scripts/enrich.mjs --country CL           # one country
 *   node scripts/enrich.mjs --limit 10             # first N countries
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateOverlay, AGENT_CLAIMABLE } from './lib/overlay.mjs';
import { TARGET_PER_COUNTRY } from './lib/flagship.mjs';
import { fetchSource, valueAppears } from './lib/verify-source.mjs';
import { appendRefutation } from './lib/refutations.mjs';
import { buildCoverage } from './lib/coverage.mjs';
import { resolveRoles, loadProviders } from './lib/providers/index.mjs';

const OVERLAY_DIR = path.join('data', 'overlay');
const REFUTATIONS = path.join('data', 'refutations.jsonl');
const COVERAGE = path.join('data', 'coverage.json');

/**
 * Fields whose value a source states verbatim, so the deterministic
 * fetch-check can decide them. Everything else in AGENT_CLAIMABLE is prose or
 * a normalised syntax and is decided by the verifier reading the page.
 */
const LITERAL_FIELDS = [
  'temperature.celsius',
  'access.price',
  'access.currency',
  'location.elevation',
];

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Attempt one spring. Returns a claim object, or null having logged why not.
 *
 * Null is a first-class result, not a failure path. The characteristic error
 * of an enrichment agent is filling a field with a plausible value rather than
 * returning nothing, so every exit here that is not a verified claim must
 * produce no file at all.
 */
export async function attempt(spring, roles, providers, refutationsFile, now) {
  const proposal = await providers.proposer.complete({
    system: `Propose verifiable facts about a hot spring. You may only propose these fields: ${AGENT_CLAIMABLE.join(', ')}. Every field needs a public source URL that states the value. If you cannot find a real source, return an empty claims object. Returning nothing is correct and expected.`,
    user: JSON.stringify({ id: spring.id, name: spring.name, country: spring.location.country }),
    schema: {
      type: 'object',
      required: ['claims'],
      properties: {
        claims: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['value', 'source'],
            properties: { value: {}, source: { type: 'string' } },
          },
        },
      },
    },
  });

  const verified = {};
  for (const [field, claim] of Object.entries(proposal?.claims ?? {})) {
    if (!AGENT_CLAIMABLE.includes(field)) continue;

    const fetched = await fetchSource(claim.source);
    if (!fetched.ok) {
      appendRefutation(refutationsFile, {
        springId: spring.id, field, proposed: claim.value, source: claim.source,
        proposer: roles.proposer, stage: 'fetch-check', outcome: fetched.outcome,
        note: 'source could not be retrieved',
      }, now());
      continue;
    }

    // A literal fetch-check only makes sense for a value a page states
    // verbatim. Measured against a realistic page, temperature and elevation
    // pass; access.notes, hours.open ("Mo-Su 09:00-21:00"), clothing.policy,
    // and description essentially never do -- an OSM-normalised or summarised
    // value is not a substring of prose. Sending them through it would record
    // them all as value-absent-from-source, which is a fact about the checker
    // masquerading as a fact about the world, in a published artifact.
    //
    // So prose fields skip the literal check and are decided by the verifier
    // alone, which reads the fetched text. They are strictly less protected;
    // that is the reason the set is small and the reason to keep it small.
    const literal = LITERAL_FIELDS.includes(field);
    if (literal && !valueAppears(claim.value, fetched.text)) {
      appendRefutation(refutationsFile, {
        springId: spring.id, field, proposed: claim.value, source: claim.source,
        proposer: roles.proposer, stage: 'fetch-check', outcome: 'value-absent-from-source',
        note: 'value not found in the retrieved page',
      }, now());
      continue;
    }

    const verdict = await providers.verifier.complete({
      system: 'You are refuting a claim. Default to refuted when uncertain. Does this source state this value about THIS spring, or about a different pool, resort, or place?',
      user: JSON.stringify({ spring: spring.name, field, value: claim.value, source: fetched.text.slice(0, 20_000) }),
      schema: {
        type: 'object',
        required: ['refuted', 'reason'],
        properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
      },
    });

    if (verdict?.refuted !== false) {
      appendRefutation(refutationsFile, {
        springId: spring.id, field, proposed: claim.value, source: claim.source,
        proposer: roles.proposer, verifier: roles.verifier, stage: 'refutation',
        outcome: 'refuted-by-verifier', note: verdict?.reason,
      }, now());
      continue;
    }

    verified[field] = {
      value: claim.value,
      source: claim.source,
      contributor: roles.proposer,
      state: 'active',
    };
  }

  return Object.keys(verified).length ? { id: spring.id, claims: verified } : null;
}

/**
 * Read a flag's value, refusing the two silent failures.
 *
 * `--country` with no value left onlyCountry undefined, which is falsy, which
 * skipped the filter and ran all 129 countries -- spending the operator's
 * whole credential on a typo. `--limit` with no value gave Number(undefined)
 * = NaN, and slice(0, NaN) is zero countries: a silent no-op that still wrote
 * coverage.json and looked like success. Both fail loudly now.
 */
function flagValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

/**
 * Run the plan. Every path is a parameter so this is testable without a
 * network, a credential, or the real data directory.
 */
/**
 * Spring ids some earlier run already tried and got nothing from.
 *
 * Derived from the refutation log rather than kept as separate state: a spring
 * with a refutation and no overlay file is one that was paid for and yielded
 * nothing. Reusing the log means there is no second bookkeeping file to get
 * out of step with reality.
 */
export function alreadyAttempted(refutationsFile) {
  if (!fs.existsSync(refutationsFile)) return new Set();
  const ids = new Set();
  for (const line of fs.readFileSync(refutationsFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      ids.add(JSON.parse(line).springId);
    } catch {
      // A half-written final line is expected here: this file is appended to
      // by runs that get killed mid-flight. Skip it rather than refusing to
      // resume -- one lost record must not cost the whole resumption.
    }
  }
  return ids;
}

export async function runPlan({
  plan, byId, knownIds, providers, roles,
  overlayDir, refutationsFile, coverageFile,
  writeCoverage = true, retryRefuted = false,
  now = () => new Date().toISOString(),
}) {
  const attemptedBefore = retryRefuted ? new Set() : alreadyAttempted(refutationsFile);
  const results = [];

  for (const { country, candidates } of plan) {
    let verified = 0;
    let attempted = 0;

    for (const id of candidates) {
      if (verified >= TARGET_PER_COUNTRY) break;
      const spring = byId.get(id);
      if (!spring) continue;

      const file = path.join(overlayDir, `${id}.json`);
      // Checked BEFORE spending. The check used to sit after the proposal and
      // refutation calls, so a re-run paid for every claim it then discarded --
      // and because it did not count toward `verified`, a country whose target
      // was already met chewed through all five candidates every time.
      if (fs.existsSync(file)) {
        verified++;
        continue;
      }

      // A spring that was tried and produced nothing leaves no overlay file,
      // so without this it is retried -- and paid for -- on every resumed run.
      // This run is expected to be killed by a credit limit and restarted many
      // times, which turns "retry the hopeless ones" into the dominant cost:
      // the springs with no findable sources are exactly the ones every
      // resumption reaches first and spends on again.
      //
      // Skipping is the default, not the only option. Sources appear and a
      // different provider pair may succeed, so --retry-refuted exists; it
      // just should not be what an interrupted run does by itself.
      if (!retryRefuted && attemptedBefore.has(id)) {
        console.log(`${id}: skipped, already attempted in an earlier run`);
        continue;
      }

      attempted++;
      const overlay = await attempt(spring, roles, providers, refutationsFile, now);
      if (!overlay) continue;

      const errors = validateOverlay(overlay, { knownIds, agentAuthored: true });
      if (errors.length) {
        console.error(`${id}: produced an invalid overlay, discarding:\n  ${errors.join('\n  ')}`);
        continue;
      }

      fs.mkdirSync(overlayDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(overlay, null, 2) + '\n');
      verified++;
    }

    results.push({ country, candidates: candidates.length, attempted, verified });
    console.log(`${country}: ${verified}/${TARGET_PER_COUNTRY} from ${attempted} attempted`);
  }

  // Only on a full run. A --country CL run holds one country's results, and
  // writing them would replace the published 129-country map with a stub.
  if (writeCoverage) {
    fs.writeFileSync(coverageFile, JSON.stringify(buildCoverage(results, now()), null, 2) + '\n');
  } else {
    console.log('Filtered run: data/coverage.json left unchanged.');
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const retryRefuted = args.includes('--retry-refuted');
  const onlyCountry = flagValue(args, '--country');
  const limitRaw = flagValue(args, '--limit');
  const limit = limitRaw === null ? Infinity : Number(limitRaw);
  // Guarded only when the flag was given: the no-flag default is Infinity,
  // which is deliberately not finite, and testing it unconditionally rejected
  // every run that did not pass --limit -- including the real full run.
  if (limitRaw !== null && (!Number.isFinite(limit) || limit < 1)) {
    throw new Error(`--limit must be a positive number, got ${JSON.stringify(limitRaw)}`);
  }

  // A bare array, not {springs: [...]}.
  const springs = loadJson(path.join('data', 'hot-springs.json'));
  const byId = new Map(springs.map((s) => [s.id, s]));
  let plan = loadJson(path.join('data', 'flagship.json'));
  const filtered = Boolean(onlyCountry) || limitRaw !== null;
  if (onlyCountry) plan = plan.filter((c) => c.country === onlyCountry);
  plan = plan.slice(0, limit);
  if (plan.length === 0) throw new Error('the filters selected no countries');

  const config = fs.existsSync('enrichment.config.json') ? loadJson('enrichment.config.json') : {};
  const roles = resolveRoles(config);

  if (dryRun) {
    const total = plan.reduce((n, c) => n + c.candidates.length, 0);
    console.log(`${plan.length} countries, up to ${total} candidates, target ${TARGET_PER_COUNTRY} each.`);
    console.log(`proposer ${roles.proposer}, verifier ${roles.verifier}. No calls made.`);
    return;
  }

  const results = await runPlan({
    plan, byId, knownIds: new Set(byId.keys()),
    providers: await loadProviders(roles), roles,
    overlayDir: OVERLAY_DIR, refutationsFile: REFUTATIONS, coverageFile: COVERAGE,
    writeCoverage: !filtered, retryRefuted,
  });

  const met = results.filter((r) => r.verified >= TARGET_PER_COUNTRY).length;
  console.log(`\n${met}/${results.length} countries met the target.`);
  console.log('Countries with no verified claim are the point, not the failure.');
}

// Guarded so the module can be imported by tests without executing a run.
if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    // Without this, a failure on country 90 of 129 is an unhandled rejection:
    // a stack trace, and no coverage map for the 89 that succeeded.
    console.error(err.message);
    process.exit(1);
  });
}
