/**
 * Verify curated claims against the pages they cite.
 *
 * Separate from validate-overlay.mjs on purpose. That one is offline,
 * instant, and safe to run anywhere -- it is contributor feedback. This one
 * makes network requests to URLs a stranger chose, which is a different kind
 * of program with a different threat model, and it belongs in a job whose
 * permissions were chosen with that in mind.
 *
 * Usage:
 *   node scripts/verify-claims.mjs                    # every overlay file
 *   node scripts/verify-claims.mjs --files a.json     # named files
 *   node scripts/verify-claims.mjs --json             # machine-readable
 *
 * Exit codes are the interface:
 *   0  nothing was contradicted
 *   1  at least one claim is contradicted by its own source -- reject
 *   2  at least one source could not be read -- undecided, safe to retry
 *
 * 1 and 2 are distinct so that a workflow cannot retry a refutation into a
 * pass. Rerunning a flaky host is correct; rerunning a wrong number is not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { verifyClaims, summarise, VERDICT } from './lib/verify-claims.mjs';

const OVERLAY_DIR = path.join('data', 'overlay');

function targetFiles(argv) {
  const at = argv.indexOf('--files');
  if (at !== -1) return argv.slice(at + 1).filter((a) => !a.startsWith('--'));
  if (!fs.existsSync(OVERLAY_DIR)) return [];
  return fs
    .readdirSync(OVERLAY_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(OVERLAY_DIR, f));
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const files = targetFiles(argv);

  if (files.length === 0) {
    console.log('No overlay files to verify.');
    return 0;
  }

  const all = [];
  for (const file of files) {
    let overlay;
    try {
      overlay = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      // Unparseable here rather than in validate-overlay means the two ran
      // against different bytes. Loud, not skipped.
      console.error(`${file}: could not be parsed: ${err.message}`);
      return 1;
    }
    const results = await verifyClaims(overlay);
    for (const r of results) all.push({ file: path.basename(file), id: overlay.id, ...r });
  }

  const { counts, code } = summarise(all);

  if (asJson) {
    console.log(JSON.stringify({ counts, code, results: all }, null, 2));
    return code;
  }

  for (const r of all) {
    const mark =
      r.verdict === VERDICT.VERIFIED ? 'ok  '
      : r.verdict === VERDICT.REFUTED ? 'FAIL'
      : r.verdict === VERDICT.UNREACHABLE ? '??  '
      : '--  ';
    console.log(`${mark} ${r.id} ${r.field}${r.detail ? `  (${r.detail})` : ''}`);
  }
  console.log(
    `\n${counts.verified} verified, ${counts.refuted} refuted, ` +
      `${counts.unreachable} unreachable, ${counts.needsReview} need a reader.`,
  );
  if (counts.needsReview > 0) {
    console.log(
      'Fields marked -- are not values that appear verbatim in a source ' +
        '(our enums, prose, price summaries). They are NOT verified.',
    );
  }
  return code;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
