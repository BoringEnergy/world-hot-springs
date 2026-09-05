/**
 * OSM element -> HotSpring. Every mapping here is a documented judgement call;
 * see docs/DATA.md for the reasoning and the audit trail.
 *
 * The one rule that overrides all others: when a tag is absent, ambiguous, or
 * unparseable, the field becomes null / "unknown". We never guess.
 */

import { OSM_PROVIDER } from './identity.mjs';

/** Fields that count toward the completeness score, in display priority order. */
const FIRST_CLASS = ['name', 'temperature', 'price', 'clothing', 'hours', 'type'];

/**
 * Parse an OSM `temperature` value into celsius.
 *
 * Real values in the wild: "45", "45 C", "45°C", "40-45", "113 F", "~42",
 * "38 °C", "hot". Ranges collapse to their midpoint.
 *
 * Qualitative values yield celsius: null, because "hot" is not a temperature.
 * They are NOT discarded, though — they come back as `qualitative`, so the
 * record can say "OpenStreetMap describes this as hot; no measurement exists"
 * instead of a bare Unknown. That distinction matters: it is the difference
 * between "nobody has looked" and "somebody looked and didn't bring a
 * thermometer". In this dataset the qualitative case is the common one.
 */
const QUALITATIVE = ['scalding', 'very hot', 'hot', 'warm', 'tepid', 'cool', 'cold'];

export function parseTemperature(raw) {
  if (!raw) return { celsius: null, note: null, qualitative: null };
  const s = String(raw).trim();

  const isF = /(^|[^a-z])f($|[^a-z])|fahrenheit/i.test(s) && !/celsius/i.test(s);
  const qualitative = QUALITATIVE.find((q) => new RegExp(`\\b${q}\\b`, 'i').test(s)) ?? null;

  // Canonicalise range separators BEFORE extracting numbers. Without this the
  // hyphen in "40-45" is read as a minus sign, the values come out [40, -45],
  // and the midpoint is -2.5 degrees. A digit on both sides of the separator is
  // what distinguishes a range from a genuinely negative reading.
  const canonical = s.replace(/(\d)\s*(?:-|–|—|to|\.\.)\s*(\d)/i, '$1\u0000$2');
  const isRange = canonical.includes('\u0000');

  const nums = canonical.match(/-?\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length === 0) return { celsius: null, note: null, qualitative };

  const vals = nums.map((n) => parseFloat(n.replace(',', '.'))).filter((n) => Number.isFinite(n));
  if (vals.length === 0) return { celsius: null, note: null, qualitative };

  // A range is stored as its midpoint, with the original kept in the note.
  let value = isRange && vals.length >= 2 ? (vals[0] + vals[1]) / 2 : vals[0];
  if (isF) value = ((value - 32) * 5) / 9;

  // Anything outside this window is a mis-tag (units confusion, sentinel value),
  // not a spring. Liquid water at surface pressure caps out near 100C.
  if (value < -5 || value > 130) {
    return { celsius: null, note: `unparseable temperature tag: "${s}"`, qualitative };
  }

  return {
    celsius: Math.round(value * 10) / 10,
    note: isRange ? `Source records a range: ${s}` : null,
    qualitative,
  };
}

/**
 * Price. OSM splits this across `fee` (yes/no) and `charge` (an amount).
 * We keep the human-facing string and pull out a currency code when one is
 * unambiguous, rather than pretending to normalise every currency to USD.
 */
export function parseAccess(tags) {
  const fee = tags.fee?.toLowerCase();
  const charge = tags.charge || tags['fee:amount'] || null;
  const notes = [];

  if (tags.access && ['permissive', 'customers', 'members'].includes(tags.access)) {
    notes.push(`Access: ${tags.access}`);
  }

  let price = null;
  let currency = null;

  if (charge) {
    price = charge.trim();
    const m = price.match(/\b([A-Z]{3})\b/);
    if (m) currency = m[1];
  } else if (fee === 'no') {
    price = 'Free';
  } else if (fee === 'yes') {
    price = 'Paid (amount unknown)';
  } else if (fee === 'donation' || tags.payment?.includes('donation')) {
    price = 'Donation';
  }

  // status/bathingAllowed are owned by the land-manager stage, never by OSM
  // tags: `access=yes` on a Yellowstone geyser means the ground is walkable,
  // not that the water is. Defaulted here so every record carries the fields
  // structurally, per the schema rule that unknown is stored, not omitted.
  return {
    price,
    currency,
    notes: notes.length ? notes.join('. ') : null,
    status: 'unknown',
    bathingAllowed: null,
  };
}

/**
 * Clothing policy. OSM's `nudism` key is the only widely-used signal.
 *   obligatory -> nudity required        -> "required"
 *   customary/yes/permissive -> optional -> "optional"
 *   no         -> textiles required      -> "textile-only"
 * `clothing_optional=yes` is a less common synonym. Gendered bathing days
 * (common at onsen and European thermae) map to "mixed" with a schedule note.
 */
export function parseClothing(tags) {
  const nudism = tags.nudism?.toLowerCase();
  const optional = tags.clothing_optional?.toLowerCase();
  let policy = 'unknown';
  const notes = [];

  if (nudism === 'obligatory') policy = 'required';
  else if (nudism === 'customary' || nudism === 'yes' || nudism === 'permissive') policy = 'optional';
  else if (nudism === 'no') policy = 'textile-only';
  else if (optional === 'yes') policy = 'optional';
  else if (optional === 'no') policy = 'textile-only';

  if (nudism === 'permissive') notes.push('Tolerated rather than formally permitted');

  let schedule = null;
  const gender = tags['bath:sex'] || tags.female || tags.male;
  if (tags['bath:sex']) {
    schedule = `Bathing areas: ${tags['bath:sex']}`;
    if (policy === 'unknown' && tags['bath:sex'] === 'separated') policy = 'mixed';
  } else if (gender) {
    schedule = 'Gender-separated bathing recorded; check on site';
  }

  return { policy, schedule, notes: notes.length ? notes.join('. ') : null };
}

/**
 * Hours. We keep the raw OSM opening_hours string, which is a real spec
 * (https://wiki.openstreetmap.org/wiki/Key:opening_hours) rather than prose,
 * and derive a coarse status from it.
 */
export function parseHours(tags) {
  const open = tags.opening_hours || null;
  const seasonalNotes = tags['opening_hours:seasonal'] || tags.seasonal || null;
  let status = 'unknown';

  if (tags.disused === 'yes' || tags['disused:natural'] || tags['disused:amenity']) status = 'closed';
  else if (open === '24/7') status = 'open';
  else if (open && /\b(Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar)\b/.test(open)) status = 'seasonal';
  else if (open) status = 'open';
  else if (seasonalNotes) status = 'seasonal';

  return { open, seasonalNotes, status };
}

/**
 * Spring type. The distinction users care about is "did someone build
 * something here": a wild pool in a riverbed vs. a bathhouse with a till.
 */
export function parseType(tags) {
  const isBath = tags.amenity === 'public_bath' || tags['bath:type'];
  const isResort =
    tags.tourism === 'hotel' ||
    tags.tourism === 'resort' ||
    tags.leisure === 'resort' ||
    /resort|hotel|ryokan|spa/i.test(tags.name || '');

  if (isResort && isBath) return 'resort';
  if (isBath) return 'developed';
  if (tags.natural === 'hot_spring') {
    // Built infrastructure on a natural source still reads as developed.
    if (tags.fee === 'yes' || tags.operator || tags.building || tags.leisure === 'swimming_pool') {
      return 'developed';
    }
    // No name, no operator, no path to it: a wild source.
    if (!tags.name && !tags.operator && !tags.website) return 'wild';
    return 'natural';
  }
  return 'unknown';
}

/** Descriptive tags a user might actually filter or scan for. */
export function deriveTags(tags, temp) {
  const out = new Set();
  if (tags['bath:open_air'] === 'yes' || tags.outdoor === 'yes') out.add('open-air');
  if (tags.indoor === 'yes' || tags.building) out.add('indoor');
  if (tags.wheelchair === 'yes') out.add('wheelchair-accessible');
  if (tags.swimming === 'yes' || tags.leisure === 'swimming_pool') out.add('swimmable');
  if (/sulf|sulph|schwefel|硫/i.test(JSON.stringify(tags))) out.add('sulfur');
  if (tags['bath:type']) out.add(tags['bath:type'].toLowerCase().replace(/[^a-z]+/g, '-'));
  if (tags.tourism === 'camp_site' || tags.camp_site) out.add('camping-nearby');
  if (temp !== null && temp >= 38 && temp <= 43) out.add('soakable');
  if (tags.drinking_water === 'yes') out.add('drinking-water');
  if (tags.wikidata || tags.wikipedia) out.add('well-documented');
  return [...out].sort();
}

/**
 * Safety and access warnings. These are generated from facts in the record, not
 * editorialised: a 60C spring will scald you, and saying so is the honest thing
 * to render next to the temperature.
 */
export function deriveWarnings(tags, temp, type) {
  const out = [];
  if (temp !== null && temp >= 50) {
    out.push('Scalding: recorded at 50°C or above. Water at this temperature causes burns in seconds.');
  } else if (temp !== null && temp >= 44) {
    out.push('Very hot: above comfortable soaking temperature for most people. Enter slowly.');
  }
  if (type === 'wild') {
    out.push('Undeveloped source: no staff, no facilities, and no maintained access. Conditions change.');
  }
  if (tags.access === 'permissive') {
    out.push('Access is permissive, not a right of way. The landowner can withdraw it at any time.');
  }
  if (tags.hazard || tags['hazard:type']) {
    out.push(`Mapped hazard: ${tags.hazard || tags['hazard:type']}.`);
  }
  if (/geyser/i.test(tags.natural || '') || tags.natural === 'geyser') {
    out.push('Geyser: eruptive. Not for bathing.');
  }
  if (tags.drinking_water === 'no') {
    out.push('Not drinking water.');
  }
  return out;
}

function completeness(record) {
  const known = [];
  if (record.name) known.push('name');
  if (record.temperature.celsius !== null) known.push('temperature');
  if (record.access.price) known.push('price');
  if (record.clothing.policy !== 'unknown') known.push('clothing');
  if (record.hours.open || record.hours.status !== 'unknown') known.push('hours');
  if (record.type !== 'unknown') known.push('type');
  return { known, score: Math.round((known.length / FIRST_CLASS.length) * 100) };
}

/**
 * Detect nodes that say `natural=hot_spring` but are almost certainly
 * mis-tagged water boreholes.
 *
 * The Kufra basin in Libya and areas around Mosul in Iraq carry hundreds of
 * nodes named `c-175`, `-193c`, `0061` — irrigation well identifiers — tagged
 * as hot springs by a bulk import and never corrected. Taken at face value they
 * make Iraq the second most geothermally active country on earth, ahead of
 * Japan and Iceland, which is obviously false.
 *
 * The test is deliberately narrow, because the cost of a false positive is
 * deleting a real spring:
 *   1. the name is a bare identifier (digits, with at most a stray c/C), AND
 *   2. the element carries no other evidence of being a spring at all — no
 *      temperature, operator, website, wikidata, fee, hours, address or
 *      description.
 *
 * A genuine spring named "0061" with literally no other tag is a record we
 * cannot say anything true about anyway.
 */
const IDENTIFIER_NAME = /^[\s\-_.#]*[cC]?[\s\-_.#]*\d+[\s\-_.#]*[cC]?[\s\-_.#]*$/;

const EVIDENCE_KEYS = [
  'temperature', 'operator', 'website', 'contact:website', 'wikidata', 'wikipedia',
  'fee', 'charge', 'opening_hours', 'description', 'tourism', 'amenity', 'leisure',
  'building', 'bath:type', 'access', 'ele', 'source', 'note', 'check_date',
];

/**
 * True when the element carries nothing but `natural` and a name. See
 * data/known-bad-imports.json for how this is used — on its own it is not
 * evidence of anything, since plenty of real springs are minimally mapped.
 */
export function isAttributeFree(tags) {
  return !Object.keys(tags).some((k) => k !== 'natural' && !k.startsWith('name'));
}

function suspectedBorehole(tags) {
  if (tags.natural !== 'hot_spring') return null;
  const name = (tags.name || '').normalize('NFKC').trim();
  if (!name || !IDENTIFIER_NAME.test(name)) return null;
  if (EVIDENCE_KEYS.some((k) => tags[k])) return null;
  if (Object.keys(tags).some((k) => k.startsWith('addr:'))) return null;
  return `identifier-style name ("${tags.name}") with no other spring attributes`;
}

/**
 * @returns {{record: object|null, reject: string|null}}
 */
export function normalizeElement(el, lookup, ingestedAt) {
  const tags = el.tags || {};

  const lat = el.lat ?? el.center?.lat ?? null;
  const lng = el.lon ?? el.center?.lon ?? null;
  if (lat === null || lng === null) return { record: null, reject: 'no geometry' };

  // Not public. The atlas is public and semi-public springs only; a spring
  // behind a locked gate is somebody's property, not a destination.
  if (tags.access === 'private' || tags.access === 'no') {
    return { record: null, reject: 'access=private/no' };
  }
  // Geysers are hot water, but they are not a place you get into.
  if (tags.natural === 'geyser' && !tags['bath:type']) {
    return { record: null, reject: 'geyser, not bathable' };
  }

  const { celsius, note: tempNote, qualitative } = parseTemperature(tags.temperature);
  const country = lookup(lat, lng);
  const type = parseType(tags);
  const name = tags.name || tags['name:en'] || tags['name:en-Latn'] || null;

  const elevation = tags.ele ? parseFloat(String(tags.ele).replace(/[^\d.\-]/g, '')) : null;

  const sources = [`https://www.openstreetmap.org/${el.type}/${el.id}`];
  if (tags.website) sources.push(tags.website);
  if (tags['contact:website']) sources.push(tags['contact:website']);
  if (tags.wikipedia) {
    const [lang, title] = tags.wikipedia.split(':');
    if (lang && title) sources.push(`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  }
  if (tags.wikidata) sources.push(`https://www.wikidata.org/wiki/${tags.wikidata}`);

  const access = parseAccess(tags);
  const clothing = parseClothing(tags);

  const record = {
    id: `osm-${el.type}-${el.id}`,
    name,
    location: {
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      elevation: Number.isFinite(elevation) ? Math.round(elevation) : null,
      country: country.iso,
      countryName: country.name,
      region: tags['addr:state'] || tags['addr:province'] || tags['is_in:state'] || null,
      nearestTown: tags['addr:city'] || tags['addr:town'] || tags['is_in:city'] || null,
    },
    temperature: {
      celsius,
      fahrenheit: celsius === null ? null : Math.round(((celsius * 9) / 5 + 32) * 10) / 10,
      source: celsius === null ? null : 'OpenStreetMap `temperature` tag',
      measuredAt: null,
      qualitative,
    },
    access,
    clothing,
    hours: parseHours(tags),
    // Present and empty on every record, never absent. A field that only
    // exists once something claims it would make `spring.minerals.ph` throw
    // on the 6,400 springs nobody has analysed, and would let applyClaim
    // build a half-shaped object one key at a time.
    //
    // OSM has no chemistry tags worth reading -- the closest is a name
    // containing "sulphur", which deriveTags already turns into a tag and
    // which is not a measurement. So this starts empty for everyone and
    // fills only from curated claims against published analyses.
    minerals: {
      ph: null, tds: null,
      sulfate: null, bicarbonate: null, chloride: null, calcium: null,
      magnesium: null, sodium: null, silica: null, iron: null,
      types: [], notes: null, measuredAt: null,
    },
    type,
    unicorn: false,
    // Nothing arriving from a bulk ingest is verified. A human has to look.
    verified: false,
    lastVerified: ingestedAt,
    sources: [...new Set(sources)],
    description: tags.description || tags['description:en'] || null,
    tags: deriveTags(tags, celsius),
    warnings: deriveWarnings(tags, celsius, type),
    // This normaliser reads OSM elements and nothing else, so it is the one
    // provider it can honestly name. The spelling comes from identity.mjs so
    // that the registry's refs and the record's provenance cannot drift apart.
    quality: { provenance: [OSM_PROVIDER], completeness: 0, known: [], ingestedAt },
  };

  if (tempNote) {
    record.temperature.source = `OpenStreetMap \`temperature\` tag. ${tempNote}`;
  } else if (celsius === null && qualitative) {
    record.temperature.source = `OpenStreetMap describes this spring as "${qualitative}". No measurement recorded.`;
  }
  if (!country.exact && country.iso !== 'XX') {
    record.quality.countryInferred = true;
  }

  const c = completeness(record);
  record.quality.completeness = c.score;
  record.quality.known = c.known;

  // Flagged rather than dropped here, so the build can quarantine these to an
  // auditable file instead of making them vanish.
  const suspect = suspectedBorehole(tags);
  if (suspect) record.quality.suspect = suspect;
  if (isAttributeFree(tags)) record.quality.attributeFree = true;

  return { record, reject: null };
}
