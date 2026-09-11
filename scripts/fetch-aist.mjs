/**
 * Mirror AIST/GSJ's onsen gazetteer into a pruned TSV this repo can read.
 *
 * Same shape as fetch-ncei.mjs and for the same reasons: the upstream is
 * pinned by sha256, the mirror is regenerated deterministically, and the
 * build never reaches the network. A hash mismatch is a stop, not a warning --
 * the pin is what makes every row key in data/ stable across a re-fetch.
 *
 * The published archive is 817 KB and the CSV inside it is 3.9 MB across 82
 * columns. This keeps the 20 columns the pipeline uses. That is a deliberate
 * prune, not a summary: every row survives, and the report and the matcher
 * both need the full set to be honest about what was not used.
 *
 * Licence: 政府標準利用規約 第2.0版, stated CC BY 4.0 compatible. Attribution
 * required and given in DATA.md; commercial use permitted.
 *
 *   node scripts/fetch-aist.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { assertHash } from './lib/ncei.mjs';
import { unzip } from './lib/zip.mjs';
import { parseAist, toTsv, AIST_URL, AIST_SOURCE } from './lib/aist.mjs';

const SHA256 = '09ceca4ebf6a4ba366c6093845f190b95e2fd3a2ad7c7d97f0ac074bc4a68cab';
const MEMBER = 'GSJ_DB_GRES-DB_ONSEN_2020.csv';
const OUT = path.join('data', 'reference', 'aist-onsen.tsv');

const res = await fetch(AIST_URL, { signal: AbortSignal.timeout(120_000) });
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());

assertHash(buf, SHA256);
console.log(`downloaded ${buf.length} bytes, sha256 verified`);

const files = unzip(buf, [MEMBER]);
// Shift_JIS, as published. Decoding as UTF-8 produces mojibake that still
// parses as a CSV and still has 82 columns, so the failure presents as every
// name disagreeing rather than as a bad decode. Checked against the archive
// itself, not against a copy something else had already transcoded.
const csv = new TextDecoder('shift_jis').decode(files.get(MEMBER));
const { rows, rejected } = parseAist(csv);

console.log(`parsed ${rows.length} rows, ${rejected.length} rejected`);
for (const r of rejected.slice(0, 10)) console.log(`  line ${r.line}: ${r.reason}`);

const header = [
  `# ${AIST_SOURCE}`,
  `# source:    ${AIST_URL}`,
  `# sha256:    ${SHA256}`,
  `# licence:   政府標準利用規約 第2.0版 (CC BY 4.0 compatible), attribution required`,
  '# generated: scripts/fetch-aist.mjs -- do not edit by hand',
  '#',
  '# Positions are the AREA CENTROID of the polygon each row publishes. Every',
  '# cell in this file is 187-191 m across, which is a publisher privacy',
  '# choice rather than GPS scatter. The centroid is a distance key only: it',
  '# must never be written to a record location or used to mint a pin.',
].join('\n');

fs.writeFileSync(OUT, `${header}\n${toTsv(rows)}`);
console.log(`wrote ${OUT}`);
