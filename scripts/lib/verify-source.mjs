/**
 * Did the cited source actually say it?
 *
 * The deterministic half of verification, and the half that catches the
 * dominant failure mode: a confident value attached to a fabricated or
 * irrelevant citation. Free, repeatable, and not subject to being talked out
 * of its answer.
 */

/**
 * Hard cap on fetched content. Rejected, never truncated -- truncation lets
 * whoever wrote the page choose where the evidence stops, which is an
 * injection primitive rather than a size control.
 */
export const MAX_SOURCE_BYTES = 2_000_000;

/** Strip markup to searchable text. Not a parser; a reducer. */
export function textOf(html) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
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
      // An integer may be written grouped: 2000 appears as "2,000" or "2.000".
      : whole.replace(/\B(?=(\d{3})+$)/g, '[.,]?');
    return new RegExp(`(?<![\\d.,])${body}(?![\\d.,]*\\d)`).test(hay);
  }

  const needle = String(value).toLowerCase().trim();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(hay);
}

/**
 * Fetch a URL and return its text, or a reason it could not be used.
 * @returns {Promise<{ok: true, text: string} | {ok: false, outcome: string}>}
 */
export async function fetchSource(url, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, outcome: 'source-unreachable' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, outcome: 'source-unreachable' };
  }

  const signal = AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { signal, redirect: 'follow' });
  } catch {
    return { ok: false, outcome: 'source-unreachable' };
  }
  if (!res.ok) return { ok: false, outcome: 'source-unreachable' };

  const body = await res.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_SOURCE_BYTES) {
    return { ok: false, outcome: 'source-unreachable' };
  }
  return { ok: true, text: textOf(body) };
}
