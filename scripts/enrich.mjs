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
 *   node scripts/enrich.mjs --max-attempts 40      # stop after N springs
 *   node scripts/enrich.mjs --retry-refuted        # re-try springs that yielded nothing
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateOverlay, AGENT_CLAIMABLE } from './lib/overlay.mjs';
import { TARGET_PER_COUNTRY } from './lib/flagship.mjs';
import { fetchSource, valueAppears } from './lib/verify-source.mjs';
import { appendRefutation } from './lib/refutations.mjs';
import { buildCoverage } from './lib/coverage.mjs';
import { resolveRoles, loadProviders } from './lib/providers/index.mjs';
import { search } from './lib/search.mjs';

const OVERLAY_DIR = path.join('data', 'overlay');
const REFUTATIONS = path.join('data', 'refutations.jsonl');
const COVERAGE = path.join('data', 'coverage.json');

/**
 * Fields whose value a source states verbatim, so the deterministic
 * fetch-check can decide them. Everything else in AGENT_CLAIMABLE is prose or
 * a normalised syntax and is decided by the verifier reading the page.
 */
export const LITERAL_FIELDS = [
  'temperature.celsius',
  'access.price',
  'access.currency',
  'location.elevation',
];

/**
 * Fields whose value must arrive as a JSON number.
 *
 * The first working run proposed `"40"` and `"3300"`, which validateOverlay
 * rejects -- so a claim the verifier accepted would have been thrown away at
 * the gate as `overlay-rejected`, a label describing none of what happened.
 *
 * Listed rather than derived from LITERAL_FIELDS by removing the one string:
 * "stated verbatim on a page" and "is a number" are different properties, and
 * the next literal field added should have to say which it is.
 */
export const NUMERIC_FIELDS = [
  'temperature.celsius',
  'access.price',
  'location.elevation',
];

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * How much of a fetched page the verifier is shown.
 *
 * The verifier's input is ~90% of a run's cost -- it reads a page excerpt at
 * every candidate, while the proposer reads a spring name. Cutting this is the
 * single biggest lever on whether a full run fits the free credit.
 */
export const SOURCE_EXCERPT_CHARS = 6_000;

/**
 * The slice of a page most likely to contain the evidence.
 *
 * Centred on the first occurrence of the claimed value, not taken from the
 * top. Naively truncating to the head is worse than not trimming at all: on a
 * long page it removes the very sentence that states the value, and the
 * verifier then correctly refutes a claim that was true. That turns a cost
 * saving into a silent accuracy loss, which is the wrong trade in a pipeline
 * whose whole purpose is not asserting things it cannot support.
 *
 * Falls back to the head when the value is not found verbatim -- for prose
 * fields it usually is not, and the head is where a page states its subject.
 */
export function sourceExcerpt(text, value, max = SOURCE_EXCERPT_CHARS) {
  if (text.length <= max) return text;

  const hay = text.toLowerCase();
  const raw = String(value).toLowerCase();
  // A decimal may be written either way on the page; try both before giving up.
  const forms = [raw, raw.replace('.', ','), raw.replace(',', '.')];
  const at = forms.map((f) => hay.indexOf(f)).find((i) => i >= 0);
  if (at === undefined) return text.slice(0, max);

  const start = Math.max(0, at - Math.floor(max / 2));
  return text.slice(start, start + max);
}

/**
 * How much of a fetched page the proposer is shown.
 *
 * Same budget as the verifier's. The proposer used to read a spring name and
 * nothing else, which is why it declined every time: it was being asked to
 * recall a citation rather than read one.
 */
export const PROPOSER_EXCERPT_CHARS = 6_000;

/**
 * How many search results one spring may cost before the run moves on.
 *
 * Four of eight results for a real spring were aggregators that block
 * crawlers. Four attempts clears that band without letting a spring whose
 * every result is junk walk the whole page of them.
 */
export const MAX_URLS_PER_SPRING = 4;

/**
 * The extraction prompt.
 *
 * "States it literally" is not a stylistic preference. `valueAppears(39, page)`
 * returned true against a page whose only 39 was inside `WhatsApp +354 777 39
 * 35`, so a midpoint computed from a published `38-40` range would clear the
 * deterministic fetch-check against a page that never states it. Claim 38 or
 * claim 40; the one number that must never be claimed is the one in between.
 */
export const PROPOSER_SYSTEM = [
  'You extract facts about one hot spring from a web page that has already been retrieved for you.',
  `You may only propose these fields: ${AGENT_CLAIMABLE.join(', ')}.`,
  'Propose a value ONLY if the supplied page text states it literally, as characters you could point to in that text.',
  'Never compute, convert, average, round, or infer a value. If the page says "38-40 C" you may claim 38 or 40, never 39.',
  'Do not use anything you know about this spring from elsewhere. The supplied text is the only evidence.',
  'If the page is about a different pool, resort, or place, or states none of these fields, return an empty claims object.',
  'Returning nothing is correct and expected.',
].join(' ');

/**
 * The refutation prompt.
 *
 * The range sentence is here because its absence cost the pipeline every
 * temperature it could have produced. The proposer is told it may claim 38 or
 * 40 from a page reading "38-40"; the verifier was told only to default to
 * refuted when uncertain, and duly refuted a correct 40 for "not 40
 * specifically, but within that range". Hot springs publish temperatures as
 * ranges more often than not, so the two instructions together meant no
 * temperature could ever be claimed.
 *
 * Resolved in favour of the endpoint: a page reading "38-40" states 38 and
 * states 40, as characters you could point to, which is exactly the literal
 * evidence the proposer was sent to look for. The midpoint remains
 * unclaimable and the general default stays -- one named case is carved out,
 * not the rule weakened.
 */
export const VERIFIER_SYSTEM = [
  'You are refuting a claim.',
  'Does this source state this value about THIS spring, or about a different pool, resort, or place?',
  'A value that is an endpoint of a range the source states is supported, not uncertain:',
  'if the source says "38-40 C" then both 38 and 40 are stated, and a claim of either is supported.',
  'A value between the endpoints is not stated: from "38-40 C", refute 39.',
  'Otherwise, default to refuted when uncertain.',
].join(' ');

/** What we ask the web for. The name is dataset text; `search` sanitises it. */
export function searchQuery(spring) {
  return `${spring.name} ${spring.location.country} hot spring water temperature`;
}

/**
 * Attempt one spring. Returns a claim object, or null having logged why not.
 *
 * Null is a first-class result, not a failure path. The characteristic error
 * of an enrichment agent is filling a field with a plausible value rather than
 * returning nothing, so every exit here that is not a verified claim must
 * produce no file at all.
 */
export async function attempt(spring, roles, providers, refutationsFile, now, {
  fetchImpl = fetch,
  searchImpl = search,
  maxUrls = MAX_URLS_PER_SPRING,
} = {}) {
  // Left to throw, deliberately. A search failure is a fact about this machine
  // -- a missing CLI, an expired credential -- not about the spring. Catching
  // it here would write a refutation and mark the spring hopeless for every
  // later run, which is the same poisoning a rate limit would cause.
  const results = await searchImpl(searchQuery(spring));

  if (results.length === 0) {
    appendRefutation(refutationsFile, {
      springId: spring.id, field: null, proposer: roles.proposer, stage: 'search',
      outcome: 'no-source-found', note: 'search returned no candidate URLs',
    }, now());
    return null;
  }

  // Fall through the result list until one actually fetches. Four of the eight
  // real results for a real spring were TripAdvisor, Viator, Facebook and
  // Marriott, and TripAdvisor blocks crawlers: a spring is not unenrichable
  // because an aggregator ranked first. Capped, so one spring walking a page
  // of junk cannot consume the run.
  let page = null;
  for (const result of results.slice(0, maxUrls)) {
    const fetched = await fetchSource(result.url, { fetchImpl });
    if (fetched.ok) {
      page = { url: result.url, text: fetched.text };
      break;
    }
    // Each failure keeps its own outcome. "The URL 404s" and "the page is
    // 3 MB" are different facts about the web and about the search backend,
    // and collapsing them would lose the only signal that says which.
    appendRefutation(refutationsFile, {
      springId: spring.id, field: null, source: result.url,
      proposer: roles.proposer, stage: 'fetch-check', outcome: fetched.outcome,
      note: 'candidate source could not be retrieved',
    }, now());
  }
  // Every candidate refused us. Each one is already logged with its reason, so
  // a second record here would double-count the same spring.
  if (!page) return null;

  const proposal = await providers.proposer.complete({
    system: PROPOSER_SYSTEM,
    user: JSON.stringify({
      spring: spring.name,
      country: spring.location.country,
      url: page.url,
      // Centred on the spring's name rather than sliced from the head, for the
      // same reason the verifier's excerpt is: a head slice on a long page
      // drops the sentence that states the value, and the proposer then
      // correctly declines a fact the page does publish.
      page: sourceExcerpt(page.text, spring.name, PROPOSER_EXCERPT_CHARS),
    }),
    // No `source` field. The model does not get to cite: we fetched the text,
    // so we own the citation. That deletes the hallucinated-URL failure mode
    // rather than catching it downstream -- and it makes the fetch-check
    // meaningful, since the text checked is provably the text quoted.
    // A number is asked for by name, per field, rather than left to the
    // untyped `value: {}` that produced "40". This is a request, not a
    // guarantee -- a model may ignore a schema -- so the type is also checked
    // below and refused there. Asking is still worth it: it is what stops the
    // string being produced at all on a provider that enforces the schema.
    schema: {
      type: 'object',
      required: ['claims'],
      properties: {
        claims: {
          type: 'object',
          properties: Object.fromEntries(NUMERIC_FIELDS.map((field) => [field, {
            type: 'object',
            required: ['value'],
            properties: { value: { type: 'number' } },
          }])),
          additionalProperties: {
            type: 'object',
            required: ['value'],
            properties: { value: {} },
          },
        },
      },
    },
  });

  const claims = Object.entries(proposal?.claims ?? {});
  // The expected outcome, and the one that otherwise leaves no trace at all.
  // No overlay file and no refutation is indistinguishable from never having
  // tried, so every resumption re-proposes exactly the springs with no
  // findable sources -- the ones each restart reaches first.
  if (claims.length === 0) {
    appendRefutation(refutationsFile, {
      springId: spring.id, field: null, source: page.url,
      proposer: roles.proposer, stage: 'proposal',
      outcome: 'no-claim-proposed', note: 'the retrieved page stated nothing claimable',
    }, now());
    return null;
  }

  const verified = {};
  for (const [field, claim] of claims) {
    if (!AGENT_CLAIMABLE.includes(field)) {
      // Recorded, not dropped. A provider reaching for `name` or `warnings` --
      // fields deliberately withheld from agents -- is one of the more
      // interesting things this log can hold, and it was previously invisible.
      appendRefutation(refutationsFile, {
        springId: spring.id, field, proposed: claim?.value, source: page.url,
        proposer: roles.proposer, stage: 'proposal',
        outcome: 'field-not-agent-claimable', note: 'field is withheld from agents',
      }, now());
      continue;
    }

    // Refused, never coerced. `Number(value)` would turn "about 40" into 40
    // and "" into 0 -- inventing precision the page never stated, which is the
    // exact failure the literal-value rule exists to prevent. Checked before
    // the fetch-check because valueAppears("40", page) is true, so a string
    // would otherwise reach the verifier and be paid for.
    if (NUMERIC_FIELDS.includes(field) && !Number.isFinite(claim?.value)) {
      appendRefutation(refutationsFile, {
        springId: spring.id, field, proposed: claim?.value, source: page.url,
        proposer: roles.proposer, stage: 'proposal', outcome: 'value-not-numeric',
        note: `${field} must be a number; the proposer returned ${typeof claim?.value}`,
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
    if (literal && !valueAppears(claim.value, page.text)) {
      appendRefutation(refutationsFile, {
        springId: spring.id, field, proposed: claim.value, source: page.url,
        proposer: roles.proposer, stage: 'fetch-check', outcome: 'value-absent-from-source',
        note: 'value not found in the retrieved page',
      }, now());
      continue;
    }

    const verdict = await providers.verifier.complete({
      system: VERIFIER_SYSTEM,
      user: JSON.stringify({
        spring: spring.name,
        field,
        value: claim.value,
        source: sourceExcerpt(page.text, claim.value),
      }),
      schema: {
        type: 'object',
        required: ['refuted', 'reason'],
        properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
      },
    });

    // Anything that is not a boolean is not an answer. Still fails closed --
    // no file is written either way, which is right when the question is
    // whether to publish -- but it is logged as its own outcome, because a run
    // that recorded `refuted-by-verifier` under a reason arguing the claim was
    // correct put a false fact into a permanent public log and poisoned the
    // resume-skip with it.
    if (typeof verdict?.refuted !== 'boolean') {
      appendRefutation(refutationsFile, {
        springId: spring.id, field, proposed: claim.value, source: page.url,
        proposer: roles.proposer, verifier: roles.verifier, stage: 'refutation',
        outcome: 'verifier-verdict-malformed', note: verdict?.reason,
      }, now());
      continue;
    }

    if (verdict.refuted) {
      appendRefutation(refutationsFile, {
        springId: spring.id, field, proposed: claim.value, source: page.url,
        proposer: roles.proposer, verifier: roles.verifier, stage: 'refutation',
        outcome: 'refuted-by-verifier', note: verdict.reason,
      }, now());
      continue;
    }

    verified[field] = {
      value: claim.value,
      source: page.url,
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
export function flagValue(args, name) {
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
  // Defaults to off: this is called repeatedly by tests, and the failure mode
  // of the other default is overwriting a published 129-country artifact.
  // `main` passes it explicitly for the only run that should write one.
  writeCoverage = false, retryRefuted = false,
  now = () => new Date().toISOString(),
  fetchImpl = fetch,
  searchImpl = search,
  // A hard ceiling on springs attempted, so a bug in the fallthrough or the
  // resume-skip cannot spend an unbounded amount. The budget lives here rather
  // than in a token ledger because a call count is the one quantity this code
  // can know before spending, and cannot be wrong about.
  maxAttempts = Infinity,
}) {
  const attemptedBefore = retryRefuted ? new Set() : alreadyAttempted(refutationsFile);
  const results = [];
  let spent = 0;
  let capped = false;

  for (const { country, candidates } of plan) {
    if (capped) break;
    let verified = 0;
    let attempted = 0;
    let alreadyHad = 0;

    for (const id of candidates) {
      if (verified + alreadyHad >= TARGET_PER_COUNTRY) break;
      const spring = byId.get(id);
      if (!spring) continue;

      const file = path.join(overlayDir, `${id}.json`);
      // Checked BEFORE spending. The check used to sit after the proposal and
      // refutation calls, so a re-run paid for every claim it then discarded --
      // and because it did not count toward `verified`, a country whose target
      // was already met chewed through all five candidates every time.
      if (fs.existsSync(file)) {
        // Counted apart from `verified`. It satisfies the target -- the atlas
        // has the claim -- but this run did not verify it, and coverage.json
        // says in its own text that it reports what this run could verify.
        alreadyHad++;
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

      // Checked here, immediately before the only place a run spends money,
      // so no path can reach a provider without passing it.
      if (spent >= maxAttempts) {
        capped = true;
        break;
      }
      spent++;

      attempted++;
      const overlay = await attempt(spring, roles, providers, refutationsFile, now, { fetchImpl, searchImpl });
      if (!overlay) continue;

      const errors = validateOverlay(overlay, { knownIds, agentAuthored: true });
      if (errors.length) {
        console.error(`${id}: produced an invalid overlay, discarding:\n  ${errors.join('\n  ')}`);
        // Discarding silently left no trace and no resume-skip, so the same
        // unusable overlay was proposed and paid for again on every restart.
        appendRefutation(refutationsFile, {
          springId: id, field: null, proposer: roles.proposer, verifier: roles.verifier,
          stage: 'validation', outcome: 'overlay-rejected', note: errors.join('; '),
        }, now());
        continue;
      }

      fs.mkdirSync(overlayDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(overlay, null, 2) + '\n');
      verified++;
    }

    results.push({ country, candidates: candidates.length, attempted, verified, alreadyHad });
    console.log(
      `${country}: ${verified}/${TARGET_PER_COUNTRY} from ${attempted} attempted` +
        (alreadyHad ? `, ${alreadyHad} already held` : ''),
    );
  }

  // Only on a full run. A --country CL run holds one country's results, and
  // writing them would replace the published 129-country map with a stub.
  if (capped) {
    // Deliberately no coverage write. A capped run stopped part-way, so every
    // country it never reached would be published as unmet -- the artifact
    // saying the sources do not exist when the truth is the budget ran out.
    // That is the exact failure the `measures` string exists to prevent.
    console.log(
      `\nStopped at the ${maxAttempts}-attempt cap. ` +
        'data/coverage.json left unchanged: a partial run cannot describe coverage.',
    );
    console.log('Re-run to continue; completed springs are skipped without spending.');
  } else if (writeCoverage) {
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

  const maxRaw = flagValue(args, '--max-attempts');
  const maxAttempts = maxRaw === null ? Infinity : Number(maxRaw);
  if (maxRaw !== null && (!Number.isFinite(maxAttempts) || maxAttempts < 1)) {
    throw new Error(`--max-attempts must be a positive number, got ${JSON.stringify(maxRaw)}`);
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
    writeCoverage: !filtered, retryRefuted, maxAttempts,
  });

  const met = results.filter((r) => r.verified + r.alreadyHad >= TARGET_PER_COUNTRY).length;
  console.log(`\n${met}/${results.length} countries met the target.`);
  console.log('Countries with no verified claim are the point, not the failure.');
}

// Guarded so the module can be imported by tests without executing a run.
// Known fragility: this compares resolved paths, so an invocation through a
// symlink -- or, on Windows, a differing drive-letter case -- makes the CLI
// exit 0 having silently done nothing. Left as is: the failure is quiet but
// harmless, and every alternative guard has an edge of its own.
if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    // Without this, a failure on country 90 of 129 is an unhandled rejection:
    // a stack trace, and no coverage map for the 89 that succeeded.
    console.error(err.message);
    process.exit(1);
  });
}
