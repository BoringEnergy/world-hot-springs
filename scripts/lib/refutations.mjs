/**
 * What the atlas declined to assert.
 *
 * A separate log from data/events.jsonl on purpose. That file is written by
 * the build and deduplicated on [type, springId, claimPath, to], which would
 * collapse "GPT proposed 42.5 and was refuted" and "Gemini proposed 42.5 and
 * was refuted" into a single line -- destroying exactly the cross-provider
 * signal that makes this worth recording at all.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Written by our code, never by a model. A free-text outcome is unqueryable
 * within a month and lets the model grade its own homework.
 *
 * Each says what we observed, never what is true of the source. Our
 * fetch-check can be wrong -- the page changed, JavaScript rendered the value,
 * the crawler was blocked. "We could not confirm" is honest;
 * "this source publishes falsehoods" is an accusation this pipeline is not
 * entitled to make in a public repository under the project's name.
 */
export const OUTCOMES = new Set([
  // Why a source failed, split four ways rather than collapsed into one.
  // "The agent invented a URL" and "the page is 3 MB" are the same outcome to
  // the run and completely different facts about the provider -- and telling
  // them apart is most of what makes the cross-provider record worth keeping.
  // A fabrication rate is computable from the first two; the second two are
  // properties of the web, not of the model.
  'source-malformed',   // unparseable, or a scheme we refuse. Not a URL at all.
  'source-not-found',   // well-formed, HTTP error. Nothing is there.
  'source-unreachable', // network failure or timeout. May be transient.
  'source-too-large',   // rejected by the byte cap, never truncated.

  'value-absent-from-source',
  'different-subject',
  'refuted-by-verifier',

  // Outcomes of a run rather than of a source. A spring that produced no
  // overlay file leaves no other trace, so without these three a resumed run
  // cannot tell "never tried" from "tried and got nothing" -- and re-pays for
  // the second on every restart.
  'no-source-found',           // search returned nothing to even try. Not the proposer's doing.
  'no-claim-proposed',         // the proposer found nothing. Correct, and expected.
  'overlay-rejected',          // it produced something validateOverlay refused.
  'field-not-agent-claimable', // it tried a field withheld from agents.
]);

export const MAX_NOTE_CHARS = 280;

/**
 * Treat a model-authored note as hostile.
 *
 * This is committed to a public repository that future agents will read, which
 * is precisely the second-order injection sink the Gate 2 spec identifies as
 * F2. The threat model does not weaken because the sink is a file rather than
 * a pull request comment.
 */
export function stripNote(note) {
  if (typeof note !== 'string') return '';
  return note
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')   // markdown links and images
    // Requires a tag-like character after `<`, or "rated 5 < 7 and 9 > 2"
    // is swallowed as a tag. Verified: a looser /<[^>]*>/ eats the middle.
    .replace(/<\/?[a-z][^>]*>/gi, '')             // html tags
    .replace(/[<>]/g, '')                         // and unterminated angles
    .replace(/\bhttps?:\/\/\S+/gi, '')            // bare urls
    // Only a mention at the start of a token, and only the sigil plus its
    // word. `[@#]\S+` deleted the whole following token, turning "C#12 is
    // fine" into "C is fine" and "me@evil.com" into "me" -- over-stripping
    // that a fixture of plain prose could never detect.
    .replace(/(^|\s)[@#][\w-]+/g, '$1')
    .replace(/\s+/g, ' ')                         // newlines included
    .trim()
    .slice(0, MAX_NOTE_CHARS);
}

/** Append one refutation. Throws rather than writing an unknown outcome. */
export function appendRefutation(file, record, timestamp) {
  if (!OUTCOMES.has(record.outcome)) {
    throw new Error(
      `outcome must be one of ${[...OUTCOMES].join(', ')}; got ${JSON.stringify(record.outcome)}`,
    );
  }
  const line = JSON.stringify({
    ts: timestamp,
    springId: record.springId,
    field: record.field,
    proposed: record.proposed ?? null,
    source: record.source ?? null,
    proposer: record.proposer ?? null,
    verifier: record.verifier ?? null,
    stage: record.stage ?? null,
    outcome: record.outcome,
    note: stripNote(record.note),
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line + '\n');
}
