/**
 * Did the cited source actually say it?
 *
 * The deterministic half of verification, and the half that catches the
 * dominant failure mode: a confident value attached to a fabricated or
 * irrelevant citation. Free, repeatable, and not subject to being talked out
 * of its answer.
 */

import { OUTCOMES } from './refutations.mjs';

/**
 * Hard cap on fetched content. Rejected, never truncated -- truncation lets
 * whoever wrote the page choose where the evidence stops, which is an
 * injection primitive rather than a size control.
 */
export const MAX_SOURCE_BYTES = 2_000_000;

/**
 * Strip markup to searchable text. Not a parser; a reducer.
 *
 * Script and style bodies are dropped before the generic tag strip, including
 * when the close tag carries whitespace (`</script >`) or never arrives --
 * otherwise code and JSON blobs become quotable evidence on a page whose
 * author we do not trust.
 *
 * What still survives, deliberately: only the three named entities below are
 * decoded, so numeric forms like `&#176;` pass through as themselves; a
 * comment containing `>` leaves its tail as text; and an attribute value
 * containing `>` ends the tag strip early, leaking the rest of the attribute.
 * None of those manufacture a number that was not already on the page.
 */
export function textOf(html) {
  return html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    // An unclosed script runs to the end of input; so does the leak.
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*$/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&deg;/gi, '°')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does `value` appear in `text`?
 *
 * Numbers are matched on a digit boundary, so 40 does not match 2400 and 42.5
 * does not match 425 -- both are real near-misses in this dataset's sources,
 * where opening hours and elevations sit beside temperatures. European decimal
 * commas are accepted because a great many of these sources are not English.
 *
 * A sign is part of the number: "-40" does not certify a claim of 40. What
 * separates a sign from a range dash is the character before it -- "38-40" has
 * a digit there, "-40" and "sub-40" do not -- so both endpoints of a published
 * range verify while a negative reading still cannot certify a positive claim.
 * That distinction matters because these sources publish temperatures as
 * ranges more often than as single values; rejecting the upper bound rejected
 * half of every published range. A false positive on temperature can burn
 * someone, so the sign half of this stays strict.
 *
 * Known limitation, ASCII only: full-width and CJK numerals do not match
 * ("２０００円", "二千" against 2000), and the string branch's word
 * boundary is an ASCII class, so a needle abutting CJK text counts as whole.
 * Japan is ~950 springs, 15% of the atlas, so this will surface as false
 * value-absent-from-source outcomes rather than as anything louder. Left for a
 * later pass; do not read a Japanese refutation rate as evidence of bad claims.
 */
export function valueAppears(value, text) {
  const hay = text.toLowerCase();

  if (typeof value === 'number') {
    // No literal spelling exists for these on a page, and "1e+21" would splice
    // a quantifier into the pattern rather than a digit.
    if (!Number.isFinite(value) || String(value).includes('e')) return false;

    const [whole, frac] = String(value).split('.');
    // Both branches need a boundary on BOTH sides. Without the trailing guard
    // on the decimal branch, 42.5 matches "42,500", "42.55", and "42.51" --
    // and the left-side test alone passes green while it does.
    const body = frac
      // A dot is unambiguously a decimal point, so trailing zeros are the same
      // number: 42.5 must match "42.50". A comma is not -- "42,500" is three
      // grouped digits in English and "42,50" is a decimal in German -- so the
      // comma branch stays strict, and a European "42,50" is a miss we accept
      // rather than reopen the thousands-separator collision.
      ? `${whole}(?:\\.${frac}0*|,${frac})`
      // An integer may be written grouped: 2000 appears as "2,000" or "2.000",
      // and it may carry the same meaningless trailing zeros: "40.0".
      : `${whole.replace(/\B(?=(\d{3})+$)/g, '[.,]?')}(?:\\.0+)?`;
    // Two separate left-side guards. The first is the digit boundary. The
    // second rejects a leading dash only when no digit precedes THAT dash --
    // nested lookbehind, so "38-40" is a range and "-40"/"sub-40" are signs.
    return new RegExp(
      `(?<![\\d.,])(?<!(?<!\\d)[-\\u2212\\u2013])${body}(?![\\d.,]*\\d)`,
    ).test(hay);
  }

  const needle = String(value).toLowerCase().trim();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(hay);
}

/**
 * Fetch a URL and return its text, or a reason it could not be used.
 *
 * The scheme check is the only network guard: host-level SSRF is NOT covered.
 * http://localhost:6379/ and http://169.254.169.254/ pass, and redirect
 * following lets a public host send us to either.
 *
 * Each failure returns its own outcome rather than one collapsed
 * "unreachable". "The provider invented this URL" and "the page is 3 MB" are
 * the same non-result to a run and completely different facts about the
 * provider, and telling them apart is most of the value of the cross-provider
 * record. Every string here is a member of OUTCOMES, asserted by a test.
 *
 * @returns {Promise<{ok: true, text: string} | {ok: false, outcome: string}>}
 */
export async function fetchSource(url, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return failure('source-malformed');
  }
  // A refused scheme is malformed, not unreachable: nothing was ever tried.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return failure('source-malformed');
  }

  const signal = AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { signal, redirect: 'follow' });
  } catch {
    return failure('source-unreachable');
  }
  // The host answered and said no. That is a fact about the page, not the net.
  if (!res.ok) return failure('source-not-found');

  // Reject on the declared length before reading a byte. The cap is a memory
  // bound as much as an evidence bound, and a hostile host streams forever.
  const declared = Number(res.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) return failure('source-too-large');

  let body;
  try {
    // The timeout covers the body stream too, so on a slow server the abort
    // lands here rather than at the header exchange. So does a mid-stream
    // reset. Either way it is an outcome, not an exception thrown at the run.
    body = await res.text();
  } catch {
    return failure('source-unreachable');
  }
  // Backstop for a missing or lying content-length.
  if (Buffer.byteLength(body, 'utf8') > MAX_SOURCE_BYTES) return failure('source-too-large');

  return { ok: true, text: textOf(body) };
}

/**
 * Fail loudly on an outcome string this module invented. A typo would
 * otherwise travel silently into the public refutation log, where it is an
 * unqueryable one-off row rather than a benchmark category.
 */
function failure(outcome) {
  if (!OUTCOMES.has(outcome)) throw new Error(`unknown outcome: ${outcome}`);
  return { ok: false, outcome };
}
