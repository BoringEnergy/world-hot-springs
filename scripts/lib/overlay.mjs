/**
 * The curated overlay: authored facts that survive an OSM rebuild.
 *
 * Claims are field-level, never whole-record. That is what lets OSM keep
 * improving the fields nobody has claimed while a claimed field stays
 * protected and its disagreement with upstream becomes a tracked event.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseSourceUrl } from './source-url.mjs';

/**
 * Fields a contributor may assert.
 *
 * Deliberately absent, and why:
 *
 *   type                    drives a safety warning (normalize.mjs, `type ===
 *                           'wild'` emits the no-staff-no-rescue notice) and
 *                           feeds the completeness score. That makes it
 *                           pipeline-owned classification, not description.
 *                           Reclassification is a separate human-reviewed
 *                           operation.
 *
 *   temperature.source      a claim already carries its own source. A second,
 *   temperature.measuredAt  separately claimable provenance field could drift
 *                           from the value it describes, or be overwritten by
 *                           someone who did not submit the reading. Both are
 *                           derived from the temperature claim instead.
 *
 *   location.lat/lng        relocation is how you would defeat the privacy
 *                           exclusion radius. It is a separate claim type
 *                           requiring human review.
 *
 *   id, unicorn, quality.*, verified, sources   pipeline-owned.
 */
export const CLAIMABLE = [
  'name',
  'temperature.celsius',
  'access.price',
  'access.currency',
  'access.notes',
  'clothing.policy',
  'clothing.schedule',
  'clothing.notes',
  'hours.open',
  'hours.seasonalNotes',
  'hours.status',
  'description',
  'tags',
  'warnings',
  'location.elevation',
  'location.region',
  'location.nearestTown',
];

/**
 * Fields an *agent* may claim: CLAIMABLE minus four, each withheld for its own
 * reason. See the phase 3 spec for the full argument.
 *
 *   location.nearestTown  findability; the privacy rule outranks completeness
 *   name                  OSM is usually right, and a bad rename hides itself
 *   warnings              safety-critical and merge-only: a fabricated warning
 *                         can never be removed by another claim
 *   tags                  merge-only and unbounded; agent fill is unprunable noise
 *
 * A first-pass posture, not a permanent judgement. A withheld field can be
 * granted later; a bad claim is already published.
 */
export const AGENT_HELD_BACK = ['location.nearestTown', 'name', 'warnings', 'tags'];

export const AGENT_CLAIMABLE = CLAIMABLE.filter((f) => !AGENT_HELD_BACK.includes(f));

/**
 * Risk tiers track physical harm if wrong, not effort to fix. A wrong
 * temperature can burn someone; a wrong name is a discoverability problem.
 *
 * Phase 1 does not enforce these — there is no review pipeline yet. They live
 * here so the allowlist and the tiers cannot drift apart before phase 2 uses
 * them, and a test asserts every claimable field carries exactly one tier.
 */
export const RISK = {
  low: [
    'hours.open',
    'access.price',
    'access.currency',
    'description',
    'tags',
    'location.region',
    'location.nearestTown',
    'location.elevation',
  ],
  elevated: ['name', 'access.notes', 'hours.seasonalNotes', 'hours.status'],
  high: [
    'temperature.celsius',
    'clothing.policy',
    'clothing.schedule',
    'clothing.notes',
    'warnings',
  ],
};

/**
 * The constraint a claim's value must satisfy, for the fields where
 * `src/lib/types.ts` declares one. A value here is either
 *
 *   'number' | 'string'   a scalar type,
 *   'string[]'            an array whose every element is a string, or
 *   [...]                 an array literal: the exact permitted values.
 *
 * `access.price` is a string, not a number: the type is `string | null`, the
 * built dataset holds 878 of them including "Free", and `src/lib/format.ts`
 * renders the value straight into the page as text. A known amount's ISO 4217
 * code belongs in `access.currency`, and tiers or seasonal variation in
 * `access.notes` -- so nothing is lost by the price staying prose.
 *
 * The two enums are transcribed from `ClothingPolicy` and `HoursStatus`. Both
 * reach the UI through a lookup keyed on the value (`CLOTHING_LABEL`,
 * `HOURS_LABEL` in src/lib/format.ts), so an off-enum value renders blank --
 * while `recomputeCompleteness` below counts it as known and raises the
 * quality score. Completeness is a measurement, not a target; a value nothing
 * can render must not be able to move it. `mixed` is currently unused in the
 * built dataset and is still permitted: the type is the contract.
 *
 * This map lives here, and enrich.mjs imports it, because validateOverlay is
 * the one gate both contribution paths pass through. When enrich.mjs kept its
 * own copy it drifted: it demanded a number for the price and refused claims
 * that the human path accepts. ARRAY_FIELDS is derived from it below for the
 * same reason.
 */
export const FIELD_TYPES = {
  'temperature.celsius': 'number',
  'location.elevation': 'number',
  'access.price': 'string',
  'clothing.policy': ['optional', 'required', 'textile-only', 'mixed', 'unknown'],
  'hours.status': ['open', 'seasonal', 'closed', 'unknown'],
  tags: 'string[]',
  warnings: 'string[]',
};

/**
 * `typeof` is not enough for a number: NaN and Infinity both pass it, and
 * either one would reach the UI as a rendered "NaN".
 */
const HAS_TYPE = {
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  string: (v) => typeof v === 'string',
};

/**
 * Fields that merge rather than replace.
 *
 * Letting a claim shrink `warnings` would let a contributor strip a scalding
 * notice off a 62°C spring. Removal is a separate human-reviewed operation --
 * which is also why every element is checked: merge-only means a wrong one is
 * permanent, and no later claim can take it back out.
 */
export const ARRAY_FIELDS = Object.keys(FIELD_TYPES).filter((f) => FIELD_TYPES[f] === 'string[]');

/** Matches a durable spring id. 12 hex characters; see identity.mjs on why. */
export const SPRING_ID = /^whs_[0-9a-f]{12}$/;

/**
 * @param {object} overlay
 * @param {{knownIds?: Set<string>, agentAuthored?: boolean}} [opts]
 * @returns {string[]} human-readable errors; empty means valid.
 */
export function validateOverlay(overlay, opts = {}) {
  const errors = [];

  if (!SPRING_ID.test(overlay?.id ?? '')) {
    errors.push(`id must look like whs_a1b2c3d4e5f6, got ${JSON.stringify(overlay?.id)}`);
  } else if (opts.knownIds && !opts.knownIds.has(overlay.id)) {
    // A well-formed id that matches nothing validates cleanly and attaches to
    // nothing. A human writing one file by hand would notice; an agent
    // generating hundreds will not.
    errors.push(`${overlay.id} is not a spring in this dataset`);
  }

  if (!overlay?.claims || typeof overlay.claims !== 'object') {
    errors.push('claims must be an object');
    return errors;
  }

  for (const [field, claim] of Object.entries(overlay.claims)) {
    if (!CLAIMABLE.includes(field)) {
      errors.push(`${field} is not claimable`);
      continue;
    }
    if (opts.agentAuthored && !AGENT_CLAIMABLE.includes(field)) {
      errors.push(`${field} is not claimable by an agent; it is reviewed by a person`);
      continue;
    }
    if (claim?.value === undefined) errors.push(`${field}: value is required`);
    if (!claim?.source) {
      errors.push(`${field}: source is required on every claim`);
    } else {
      // Structure, not just presence. "source is required" was satisfied by
      // any truthy string -- "yes" passed -- so the promise that every claim
      // carries a checkable citation was weaker than it read. This is the
      // same function the verifier uses before it fetches, so the gate cannot
      // accept a URL the verifier will then refuse to check.
      const parsed = parseSourceUrl(claim.source);
      if (!parsed.ok) errors.push(`${field}: ${parsed.reason}`);
    }
    if (!claim?.contributor) errors.push(`${field}: contributor is required`);

    const expected = FIELD_TYPES[field];
    if (field === 'temperature.celsius') {
      // Type and range in one message, because a temperature is wrong the same
      // way whether it arrives as "38" or as 318: it is not a number in the
      // range a spring can be.
      const v = claim?.value;
      if (!HAS_TYPE[expected](v) || v < -5 || v > 130) {
        errors.push(`${field}: must be a number between -5 and 130, got ${JSON.stringify(v)}`);
      }
    } else if (Array.isArray(expected)) {
      // Name the permitted values. Being told "clothes off" is wrong without
      // being told what is right leaves a contributor guessing at a closed set
      // they have no other way to see.
      if (!expected.includes(claim?.value)) {
        errors.push(
          `${field}: value must be one of ${expected.join(', ')}, `
          + `got ${JSON.stringify(claim?.value)}`,
        );
      }
    } else if (expected === 'string[]') {
      if (!Array.isArray(claim?.value)) {
        errors.push(`${field}: value must be an array`);
      } else {
        // Indexed, not `.find`: a null or undefined element is exactly the
        // kind a sentinel-returning search would report as "nothing wrong".
        const bad = claim.value.findIndex((el) => typeof el !== 'string');
        if (bad !== -1) {
          errors.push(
            `${field}: every element must be a string, `
            + `but [${bad}] is ${JSON.stringify(claim.value[bad]) ?? String(claim.value[bad])}`,
          );
        }
      }
    } else if (expected && !HAS_TYPE[expected](claim?.value)) {
      errors.push(`${field}: value must be a ${expected}, got ${JSON.stringify(claim?.value)}`);
    }
  }

  return errors;
}

/**
 * Load every overlay file, failing loudly on a malformed one.
 *
 * A parse failure must never degrade to "no claims", which would silently
 * discard authored corrections — the same reasoning that makes a malformed
 * exclusion list fatal rather than empty.
 */
export function loadOverlays(dir) {
  if (!fs.existsSync(dir)) return new Map();
  const overlays = new Map();

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const full = path.join(dir, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      throw new Error(`${full} is not valid JSON: ${err.message}`);
    }
    // Deliberately no knownIds: this runs mid-build, and build-dataset.mjs
    // already fatals on an overlay that lands on nothing. Neither check is
    // redundant -- that one catches orphans here, validate-overlay.mjs catches
    // them in CI, before a contributor's PR is merged.
    const errors = validateOverlay(parsed);
    if (errors.length) {
      throw new Error(`${full} is invalid:\n  ${errors.join('\n  ')}`);
    }
    if (overlays.has(parsed.id)) {
      throw new Error(`${full} declares id ${parsed.id}, which another overlay file already claims`);
    }
    overlays.set(parsed.id, parsed);
  }

  return overlays;
}

const FIRST_CLASS_COUNT = 6;

/**
 * Per-field tolerance for calling two values a disagreement.
 *
 * Temperature gets 0.5°C of slack: a thermometer and an OSM tag differing by a
 * fraction of a degree is measurement noise, not a conflict worth a human's
 * attention. Everything else is exact.
 */
const TOLERANCE = { 'temperature.celsius': 0.5 };

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  const last = parts.pop();
  let target = obj;
  for (const part of parts) target = target[part];
  target[last] = value;
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

function disagrees(field, upstream, claimed) {
  // Absence is not disagreement. A null upstream value means nobody has
  // recorded one, which is the ordinary case a claim exists to fill.
  if (upstream === null || upstream === undefined) return false;
  const slack = TOLERANCE[field];
  if (slack !== undefined && typeof upstream === 'number' && typeof claimed === 'number') {
    return Math.abs(upstream - claimed) > slack;
  }
  return upstream !== claimed;
}

/** Mirrors the scoring in normalize.mjs so a claimed field counts as known. */
function recomputeCompleteness(r) {
  const known = [];
  if (r.name) known.push('name');
  if (r.temperature.celsius !== null) known.push('temperature');
  if (r.access.price) known.push('price');
  if (r.clothing.policy !== 'unknown') known.push('clothing');
  if (r.hours.open || r.hours.status !== 'unknown') known.push('hours');
  if (r.type !== 'unknown') known.push('type');
  return { known, score: Math.round((known.length / FIRST_CLASS_COUNT) * 100) };
}

/**
 * Apply active claims over derived records.
 *
 * @returns {{records, applied: number, orphaned: string[], events: object[]}}
 *   `orphaned` lists overlay ids with no matching record this build. They are
 *   reported rather than dropped: a claim with nowhere to land is a correction
 *   about to be lost, and the caller decides whether that is fatal.
 */
export function applyOverlays(records, overlays) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const events = [];
  let applied = 0;

  for (const [springId, overlay] of overlays) {
    const record = byId.get(springId);
    if (!record) continue;

    for (const [field, claim] of Object.entries(overlay.claims)) {
      if (claim.state !== 'active') continue;

      const upstream = getPath(record, field);

      if (ARRAY_FIELDS.includes(field)) {
        // Merge, never replace, so a claim cannot strip a derived scalding
        // notice. Merging also means there is nothing to contest.
        setPath(record, field, [...new Set([...(upstream || []), ...claim.value])]);
      } else {
        if (disagrees(field, upstream, claim.value)) {
          // The curated value keeps rendering, so the site never regresses.
          // The disagreement becomes a review item instead.
          events.push({
            type: 'claim.contested',
            springId,
            claimPath: field,
            from: upstream,
            to: claim.value,
            actor: 'build',
          });
        }
        setPath(record, field, claim.value);
      }

      if (field === 'temperature.celsius') {
        record.temperature.fahrenheit = Math.round(((claim.value * 9) / 5 + 32) * 10) / 10;
        // Derived from the claim, never separately claimable, so provenance
        // cannot drift from the value it describes.
        record.temperature.source = `Curated claim by ${claim.contributor}: ${claim.source}`;
        record.temperature.measuredAt = claim.measuredAt ?? null;
      }

      record.sources = [...new Set([...record.sources, claim.source])];
      applied++;
    }

    const c = recomputeCompleteness(record);
    record.quality.completeness = c.score;
    record.quality.known = c.known;
    record.quality.curated = true;
  }

  const orphaned = [...overlays.keys()].filter((id) => !byId.has(id));
  return { records, applied, orphaned, events };
}
