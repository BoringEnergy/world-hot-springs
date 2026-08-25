/**
 * Durable spring identity.
 *
 * `osm-node-123` is stable only while that OSM node exists. Nodes get deleted
 * and redrawn, and an orphaned claim is a correction somebody lost. Springs
 * therefore carry an id of ours, resolved against a committed registry.
 */
import { distanceMeters, normName } from './geo.mjs';

/** Different element types within this radius are one feature mapped twice. */
export const SAME_FEATURE_METERS = 60;
/** Two anonymous records must be practically on top of each other to merge. */
export const ANONYMOUS_METERS = 12;
/** An identical name this far apart is one destination mapped as several pools. */
export const EXACT_NAME_METERS = 300;
/**
 * Shortest normalised name allowed to participate in substring matching.
 *
 * normName strips spaces and punctuation, so short numbered/labelled names
 * collide by coincidence: "No. 4" -> "no4" and "No. 4b" -> "no4b" are two
 * distinct numbered pools at one site, measured 62m apart in the real
 * dataset -- just outside SAME_FEATURE_METERS, saved from merging only by
 * luck. A name this short is weak evidence of identity unless it matches
 * exactly, so only names longer than this threshold are eligible for the
 * substring branch; exact-equality matching is unaffected at any length.
 */
export const MIN_SUBSTRING_NAME_LENGTH = 4;

/** 'osm-node-123' -> 'node' */
export function osmType(id) {
  return id.split('-')[1];
}

/** 'osm-node-123' -> 'node/123' */
export function osmRefOf(id) {
  const [, type, num] = id.split('-');
  return `${type}/${num}`;
}

/**
 * Are these two records the same physical spring?
 *
 * Erring toward "no" is the safer failure. A leftover duplicate is visible and
 * fixable; a wrong merge silently deletes a real spring.
 */
export function isSameSpring(a, b) {
  const d = distanceMeters(a.location, b.location);
  const an = normName(a.name);
  const bn = normName(b.name);

  if (an && bn) {
    if (an === bn) return d <= EXACT_NAME_METERS;
    // A substring match is weaker evidence ("Blue Spring" vs "Blue Spring
    // Lodge"), so it keeps the tight radius, and requires both names to
    // clear MIN_SUBSTRING_NAME_LENGTH (see its comment).
    return (
      d <= SAME_FEATURE_METERS &&
      an.length > MIN_SUBSTRING_NAME_LENGTH &&
      bn.length > MIN_SUBSTRING_NAME_LENGTH &&
      (an.includes(bn) || bn.includes(an))
    );
  }

  // One named, one not: the source-and-pool case, which shows up as two
  // different element types. Same type means two features somebody mapped
  // individually, so leave them alone.
  if (an || bn) {
    return d <= SAME_FEATURE_METERS && osmType(a.id) !== osmType(b.id);
  }

  return d <= ANONYMOUS_METERS;
}
