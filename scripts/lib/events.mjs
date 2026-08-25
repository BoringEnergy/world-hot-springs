/**
 * The decision log.
 *
 * Append-only, one JSON object per line, committed. Phase 1 only writes it;
 * the self-improving loop reads it later, once there is enough history to
 * learn from. Instrument now, learn later — tuning on five observations is
 * superstition with extra steps.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Identity of a claim's *current state*, so a rebuild does not re-report it.
 *
 * Note this deliberately excludes `from`: if upstream drifts 42 -> 43 while a
 * claim still says 38, that is the same unresolved disagreement, not news.
 * Including `from` would re-report the conflict every time an OSM mapper
 * touched the value.
 */
function stateKey(e) {
  return [e.type, e.springId ?? '', e.claimPath ?? '', JSON.stringify(e.to ?? null)].join(' ');
}

export function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line, i) => {
      if (!line.trim()) return null;
      try {
        return JSON.parse(line);
      } catch (err) {
        // A corrupt log must never be treated as an empty one; that would
        // silently re-report every historical event as new.
        throw new Error(`${file} line ${i + 1} is not valid JSON: ${err.message}`);
      }
    })
    .filter(Boolean);
}

/**
 * Append events that say something new.
 *
 * The build runs repeatedly over unchanged data, so an unconditional append
 * would add the same "contested" line every time until the log dwarfed the
 * dataset. An event is written only when no existing event already records
 * that state for that claim.
 *
 * @returns {number} how many events were actually written
 */
export function appendEvents(file, events, timestamp) {
  if (events.length === 0) return 0;

  const seen = new Set(readEvents(file).map(stateKey));
  const fresh = [];
  for (const e of events) {
    const key = stateKey(e);
    // Guard within the batch as well as against history: one build can emit
    // the same state twice, and appending both would corrupt the count.
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(e);
  }
  if (fresh.length === 0) return 0;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = fresh.map((e) => JSON.stringify({ ts: timestamp, ...e })).join('\n');
  fs.appendFileSync(file, lines + '\n');
  return fresh.length;
}
