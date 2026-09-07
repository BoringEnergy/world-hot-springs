/**
 * Parse the committed NCEI mirror.
 *
 * Pure: text in, records out. The build reads the mirror rather than the
 * upstream .xlsx because the source product was decommissioned in May 2025 and
 * a frozen dataset must not be a live dependency of a reproducible build.
 *
 * Every row is checked against itself. The source publishes both Fahrenheit
 * and Celsius, so the two must agree under conversion; a row where they do not
 * was either mis-sliced on the way in or is internally inconsistent, and
 * neither is safe to publish as a temperature.
 */
import crypto from 'node:crypto';

/** The source's own shorthand, mapped to the vocabulary normalize.mjs uses. */
const QUALITATIVE_CODES = { B: 'boiling', H: 'hot', W: 'warm' };

/**
 * Degrees Celsius. The 1981 tables round both columns to whole numbers, so
 * exact agreement is the exception: 135F is 57.2C and the table prints 56.
 */
const FC_TOLERANCE = 1.5;

/**
 * The pin. This dataset never passes through gate 2, so the hash is what
 * stands in for verification: the bytes are fixed and the conversion is
 * reproducible from them. A mismatch is refused loudly rather than warned
 * about, because a silently regenerated mirror is an unreviewed data change.
 */
export function assertHash(buf, expected) {
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== expected) {
    throw new Error(
      `sha256 mismatch.\n  expected ${expected}\n  got      ${got}\n` +
        'The pinned upstream changed. Do NOT regenerate the mirror until a ' +
        'human has read the diff and updated the pin deliberately.',
    );
  }
  return got;
}

export function parseNcei(text) {
  const springs = [];
  const rejected = [];

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = raw.split('\t');
    if (cols[0] === 'state') continue; // header

    const [state, latS, lngS, name, tf, tc] = cols.map((c) => (c ?? '').trim());
    const lat = Number(latS);
    const lng = Number(lngS);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      rejected.push({ line, reason: 'unparseable coordinate' });
      continue;
    }

    const code = QUALITATIVE_CODES[String(tc).toUpperCase()];
    if (code) {
      springs.push({ state, lat, lng, name: name || null, celsius: null, qualitative: code });
      continue;
    }

    const f = Number(tf);
    const c = Number(tc);
    if (!Number.isFinite(c)) {
      rejected.push({ line, reason: 'no usable temperature' });
      continue;
    }
    if (Number.isFinite(f) && Math.abs(((f - 32) * 5) / 9 - c) > FC_TOLERANCE) {
      rejected.push({ line, reason: `Fahrenheit and Celsius disagree: ${tf}F vs ${tc}C` });
      continue;
    }
    springs.push({ state, lat, lng, name: name || null, celsius: c, qualitative: null });
  }

  return { springs, rejected };
}
