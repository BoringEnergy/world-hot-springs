/**
 * Which AIST analysis belongs to which spring in this atlas.
 *
 * Enrichment only. Nothing here mints a pin, moves one, or writes a
 * coordinate: AIST publishes a 187-191 m cell per row, which is a publisher
 * privacy choice, and a cell that wide in a mountain valley is enough to put a
 * pin on the wrong ravine. The centroid is a distance key and nothing else.
 *
 * The name rule is the one this repository already argued for in
 * identity.mjs, applied here rather than loosened. Measured against the real
 * data, accepting a short stripped name at the 200 m gate would take the yield
 * from ~20 to 130 -- and 91 of those 130 rest on a name of three characters or
 * fewer, in a country where onsen cluster, against a source whose position is
 * a 190 m cell. identity.mjs already decided that a short CJK name is a
 * complete name rather than a fragment, and is therefore eligible for
 * substring matching, but only within ANONYMOUS_METERS (12 m), because "at a
 * few metres apart, near-coincident position supplies the identity evidence
 * the short name can't; at tens of metres, it's coincidence."
 *
 * Accepting it at 200 m would mean this project holds one standard for merging
 * two OSM records and a looser one for attaching a government analysis to
 * somebody's bath. So: a match may rest on SUBSTRING agreement only when both
 * stripped names are at least MIN_SUBSTRING_NAME_LENGTH. Shorter names stay
 * eligible for EXACT agreement. That costs about 110 of 130 matches and it is
 * the right trade.
 */
import { distanceMeters, normName } from './geo.mjs';
import { MIN_SUBSTRING_NAME_LENGTH } from './identity.mjs';

/** The same 200 m gate NCEI uses. Two upstreams, one positional standard. */
export const AIST_RADIUS_M = 200;

/**
 * Words both sides write inconsistently. Measured: stripping these adds nine
 * real pairs -- 茂岩温泉 to 茂岩・盃, 新鳩ノ湯温泉 to 新鳩の湯,
 * 秩父温泉 満願の湯 to 秩父満願の湯, 天然温泉 平和島 to 平和島温泉.
 */
const NOISE = /(温泉|旅館|ホテル|荘|の湯|ノ湯)/g;

export const stripped = (n) => normName(String(n ?? '').replace(NOISE, ''));

/**
 * Do these two names identify the same place?
 *
 * Returns the kind of agreement, because the caller needs to know whether a
 * match rested on substring evidence: that is the thing the length rule
 * governs. `null` means they do not agree.
 */
export function nameAgreement(atlasName, aistName) {
  const a = stripped(atlasName);
  const b = stripped(aistName);
  if (!a || !b) return null;
  if (a === b) return 'exact';
  if (!(a.includes(b) || b.includes(a))) return null;
  // Substring agreement is only evidence when both names are long enough to
  // carry information. Two characters inside a longer name is a coincidence
  // with a plausible story attached.
  if (a.length < MIN_SUBSTRING_NAME_LENGTH || b.length < MIN_SUBSTRING_NAME_LENGTH) return null;
  return 'substring';
}

/** Fields an AIST row can contribute, and how close two wells must be to agree. */
export const NUMERIC_FIELDS = [
  ['celsius', 1],
  ['ph', 0.1],
  ['tds', 1],
  ['sodium', 1],
  ['calcium', 1],
  ['magnesium', 1],
  ['iron', 0.1],
  ['chloride', 1],
  ['sulfate', 1],
  ['bicarbonate', 1],
  ['silica', 1],
];

/**
 * Do these wells agree closely enough to publish one number for the group?
 *
 * Never average and never take the nearest well: both compute a value nobody
 * published, which is what rule 2 forbids. Measured, the recovery from
 * agreeing groups is small -- seven temperatures, eleven pH -- because the
 * wells under one onsen name genuinely differ in depth and source. So this
 * exists for correctness, not for yield.
 */
export function agreedValue(rows, field, tolerance) {
  const vals = rows.map((r) => r[field]).filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  if (Math.max(...vals) - Math.min(...vals) > tolerance) return null;
  // Every well says the same thing to within tolerance, so any of them is the
  // published value. Take the first rather than a computed central figure.
  return vals[0];
}

/** Units must agree too, or the group's figures are not commensurable. */
export function agreedUnit(rows) {
  const units = new Set(rows.map((r) => r.unit).filter(Boolean));
  return units.size === 1 ? [...units][0] : null;
}

/** The most recent stated year in a group, or null when none states one. */
export function agreedYear(rows) {
  const years = rows.map((r) => r.measuredAt).filter(Boolean).sort();
  return years.length ? years[years.length - 1] : null;
}

/**
 * Match AIST rows to atlas springs.
 *
 * Rows are grouped by 温泉名 first, because that is the unit AIST names: one
 * onsen, several wells. A group attaches to at most one spring, and a spring
 * receives at most one group -- contention in either direction is a rejection,
 * never a tie-break, exactly as the NCEI matcher does it.
 */
export function matchAist(rows, atlasRecords) {
  const japan = atlasRecords.filter((r) => r.location.country === 'JP');

  const groups = new Map();
  for (const row of rows) {
    const key = row.onsenName ?? `__ser:${row.ser}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const candidates = [];
  const rejected = [];

  for (const [key, group] of groups) {
    // A group's rows sit in different cells, so each row gets its own look and
    // the group claims a spring only if its rows agree on which one.
    const hits = new Map();
    for (const row of group) {
      for (const rec of japan) {
        const d = distanceMeters({ lat: row.lat, lng: row.lng }, rec.location);
        if (d > AIST_RADIUS_M) continue;
        const agreement = nameAgreement(rec.name, row.onsenName)
          ?? nameAgreement(rec.name, row.sourceName);
        if (!agreement) continue;
        const prev = hits.get(rec.id);
        if (!prev || d < prev.meters) hits.set(rec.id, { rec, meters: Math.round(d), agreement });
      }
    }
    if (hits.size === 0) continue;
    if (hits.size > 1) {
      rejected.push({ group: key, reason: 'one group, several springs', ids: [...hits.keys()] });
      continue;
    }
    const [{ rec, meters, agreement }] = [...hits.values()];
    candidates.push({ id: rec.id, group: key, rows: group, meters, agreement });
  }

  // A spring claimed by two different onsen groups is contention the other way
  // round, and is rejected the same way.
  const byId = new Map();
  for (const c of candidates) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);

  const matched = [];
  for (const [id, group] of byId) {
    if (group.length > 1) {
      rejected.push({ id, reason: 'several groups, one spring', groups: group.map((g) => g.group) });
      continue;
    }
    matched.push(group[0]);
  }
  return { matched, rejected };
}
