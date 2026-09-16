/**
 * The deployed bundle carries no test instrumentation, and the e2e bundle
 * carries all of it.
 *
 * MapView exposes `window.__map` and a set of `data-map-*` attributes to
 * whatever is driving the page. The dev server always had them; the browser
 * harness needs them in a production build too, so they also switch on in the
 * `e2e` build mode. That makes "the hooks are absent from what Vercel ships" a
 * property of how a constant folds, and a constant that folds the wrong way
 * looks exactly like one that folds the right way until somebody reads the
 * bundle. This reads the bundle.
 *
 * The markers are DERIVED from MapView.tsx rather than listed here. A list
 * kept beside the component is a second copy of a fact, and the day someone
 * adds `dataset.mapFoo` the copy would silently stop covering it.
 *
 *   node scripts/check-bundle.mjs dist                    none may be present
 *   node scripts/check-bundle.mjs dist-e2e --expect-present   all must be
 *
 * The second form is not decoration. Without it, a derivation that found
 * nothing would make the first form pass on every bundle ever built.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAPVIEW = path.join('src', 'components', 'MapView.tsx');

/** What a bundle can carry a marker in. Source maps are not deployed. */
const SCANNED = new Set(['.js', '.mjs', '.html']);

/**
 * Every instrumentation marker MapView writes: the `__map` global, and each
 * `dataset.map*` key. Property names survive minification, so these are the
 * strings a bundle carries if and only if the hooks were compiled in.
 */
export function findMarkers(source) {
  const found = new Set();
  for (const m of source.matchAll(/\.(__map)\b/g)) found.add(m[1]);
  for (const m of source.matchAll(/\bdataset\.(map[A-Z]\w*)/g)) found.add(m[1]);
  return [...found].sort();
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (SCANNED.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/**
 * Which markers appear in which files under `dir`.
 *
 * Matched as whole identifiers, so `mapReady` is not found inside
 * `mapReadyAt` or `__map` inside `__mapper`. Any library that happens to
 * carry a longer name would otherwise report the hooks present in a bundle
 * that has none, and a check that cries wolf gets deleted.
 */
export function scanBundle(dir, markers) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`${dir} does not exist; build it first`);
  }
  const files = walk(dir);
  if (files.length === 0) throw new Error(`${dir} holds no .js or .html files; nothing to check`);
  const hits = new Map(markers.map((k) => [k, []]));
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const k of markers) {
      if (new RegExp(`(?<![\\w$])${k}(?![\\w$])`).test(text)) hits.get(k).push(file);
    }
  }
  return hits;
}

/** Problems as strings; empty means the bundle is what it should be. */
export function checkBundle(dir, { expectPresent = false, source = fs.readFileSync(MAPVIEW, 'utf8') } = {}) {
  const markers = findMarkers(source);
  if (markers.length === 0) {
    return [`no instrumentation markers found in ${MAPVIEW}; the derivation is broken, so this check proves nothing`];
  }
  const hits = scanBundle(dir, markers);
  const problems = [];
  for (const [k, files] of hits) {
    if (expectPresent && files.length === 0) problems.push(`${k}: absent from ${dir}`);
    if (!expectPresent && files.length > 0) problems.push(`${k}: present in ${files.join(', ')}`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const expectPresent = args.includes('--expect-present');
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('usage: node scripts/check-bundle.mjs <dir> [--expect-present]');
    process.exit(2);
  }
  let problems;
  try {
    problems = checkBundle(dir, { expectPresent });
  } catch (err) {
    console.error(`check-bundle: ${err.message}`);
    process.exit(1);
  }
  const markers = findMarkers(fs.readFileSync(MAPVIEW, 'utf8'));
  if (problems.length > 0) {
    console.error(
      expectPresent
        ? `check-bundle: ${dir} is missing instrumentation the harness depends on:`
        : `check-bundle: ${dir} ships test instrumentation:`,
    );
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(
    `check-bundle: ${dir} ${expectPresent ? 'carries all' : 'carries none'} of ${markers.length} markers (${markers.join(', ')})`,
  );
}
