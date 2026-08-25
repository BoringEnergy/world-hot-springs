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
 * Below this normalised length, a substring match is weak evidence on its
 * own and needs distance to make up the difference.
 *
 * This is about evidence, not character count. normName strips spaces and
 * punctuation, so short numbered/labelled names collide by coincidence:
 * "No. 4" -> "no4" and "No. 4b" -> "no4b" are two distinct numbered pools
 * at one site, measured 62m apart in the real dataset -- just outside
 * SAME_FEATURE_METERS, saved from merging only by luck. But a short name is
 * not inherently a fragment: "風の湯" and "大湯" are complete, meaningful
 * three- and two-character Japanese names, and Arabic and Chinese names are
 * similarly compact. Treating "short" as "incomplete" would wrongly split
 * genuine CJK/Arabic duplicates that happen to sit right on top of each
 * other.
 *
 * So instead of excluding short names from the substring branch, they stay
 * eligible but only within ANONYMOUS_METERS -- the radius already reserved
 * for cases with no name to go on. At a few metres apart, near-coincident
 * position supplies the identity evidence the short name can't; at tens of
 * metres, it's coincidence. Exact-equality matching is unaffected at any
 * length or distance up to EXACT_NAME_METERS.
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
    // Lodge"), so it keeps the tight radius -- unless one of the names is
    // short enough that the match itself is weak evidence (see
    // MIN_SUBSTRING_NAME_LENGTH), in which case only near-coincident
    // position can make up for it.
    if (!(an.includes(bn) || bn.includes(an))) return false;
    const shortName = an.length <= MIN_SUBSTRING_NAME_LENGTH || bn.length <= MIN_SUBSTRING_NAME_LENGTH;
    return d <= (shortName ? ANONYMOUS_METERS : SAME_FEATURE_METERS);
  }

  // One named, one not: the source-and-pool case, which shows up as two
  // different element types. Same type means two features somebody mapped
  // individually, so leave them alone.
  if (an || bn) {
    return d <= SAME_FEATURE_METERS && osmType(a.id) !== osmType(b.id);
  }

  return d <= ANONYMOUS_METERS;
}
