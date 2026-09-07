/**
 * Rebuild data/reference/ncei-thermal-springs.tsv from the pinned upstream.
 *
 * Maintainer-run, NEVER part of `data:build`. The build reads the committed
 * mirror so it stays offline and byte-reproducible; this script is how the
 * mirror comes to exist, and it is expected to run approximately never -- the
 * source has not changed since 1980 and was decommissioned in May 2025.
 *
 * The hash is the trust. This dataset never reaches gate 2, so what stands in
 * for verification is that the bytes are pinned and the conversion is
 * reproducible from them.
 *
 *   node scripts/fetch-ncei.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { assertHash } from './lib/ncei.mjs';

const URL_XLSX =
  'https://www.ncei.noaa.gov/data/oceans/archive/arc0238/0303600/1.1/data/0-data/' +
  'geothermal_database/data/NCEI-thermal-springs.xlsx';
const SHA256 = 'bb3e65d8fbf34d25b6e6d071f86dc5d67f68ee022d55ff7aac428d29283d351c';
const OUT = path.join('data', 'reference', 'ncei-thermal-springs.tsv');
const DOI = '10.25921/c8p0-zs06';

/**
 * Read named members out of a zip, using only node:zlib.
 *
 * An .xlsx is a zip of XML, so no dependency is needed and none is added. The
 * central directory is the authority on sizes -- a local header may defer them
 * to a trailing data descriptor, so reading sizes from the local header alone
 * silently truncates entries written by some producers.
 */
function unzip(buf, wanted) {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const exLen = buf.readUInt16LE(p + 30);
    const cmLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + fnLen);
    p += 46 + fnLen + exLen + cmLen;

    if (!wanted.includes(name)) continue;
    const lFnLen = buf.readUInt16LE(local + 26);
    const lExLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lFnLen + lExLen;
    const raw = buf.subarray(start, start + csize);
    out.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
  }
  for (const w of wanted) if (!out.has(w)) throw new Error(`missing from workbook: ${w}`);
  return out;
}

function readSheet(files) {
  const ss = files.get('xl/sharedStrings.xml').toString('utf8');
  const strings = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => t[1])
      .join('')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim(),
  );
  const sheet = files.get('xl/worksheets/sheet1.xml').toString('utf8');
  // Both cell forms, explicitly. A self-closing <c r="B6" s="1"/> carries no
  // value, and a lazy pattern lets it swallow the next populated cell and
  // shift every column after it.
  const CELL = /<c\s+r="([A-Z]+)\d+"([^>/]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const rows = [];
  for (const r of sheet.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const vals = [];
    for (const c of r[2].matchAll(CELL)) {
      const v = (c[3] ?? '').match(/<v>([\s\S]*?)<\/v>/);
      if (!v) continue;
      vals.push(/t="s"/.test(c[2]) ? (strings[Number(v[1])] ?? '') : v[1]);
    }
    if (vals.length) rows.push(vals);
  }
  return rows;
}

const isTemp = (s) => /^\d{1,3}(\.\d+)?$/.test(s) || /^[BHW]$/i.test(s);

/**
 * Is this cell pair a Fahrenheit/Celsius reading of one temperature?
 *
 * This is what distinguishes the reading from the reference columns that
 * follow it. Every row ends with map sheet and page numbers -- small integers,
 * indistinguishable from a temperature by shape alone -- so shape is not
 * enough. The pair must also agree under conversion, which the reference
 * numbers do not. 1.5C of slack because the 1981 tables round both columns.
 */
function isTempPair(a, b) {
  if (!isTemp(a) || !isTemp(b)) return false;
  const letterA = /^[BHW]$/i.test(a);
  const letterB = /^[BHW]$/i.test(b);
  if (letterA || letterB) return letterA && letterB && a.toUpperCase() === b.toUpperCase();
  return Math.abs(((Number(a) - 32) * 5) / 9 - Number(b)) <= 1.5;
}

/**
 * Slice a row into fields. The name may span several cells and may itself
 * contain digits ("SPRING 1 (RENO)"), so the temperature is found as the first
 * self-consistent pair rather than by counting columns from either end.
 */
function sliceRow(vals) {
  if (vals.length < 6 || !/^[A-Z]{2}$/.test(vals[0])) return null;
  let tIdx = -1;
  for (let i = 4; i < vals.length - 1; i++) {
    if (isTempPair(vals[i], vals[i + 1])) { tIdx = i; break; }
  }
  // Two rows are listed with no temperature at all. A mirror should be
  // faithful and let the parser decide what is usable, so they are carried
  // through as "null" rather than dropped here; parseNcei rejects them with
  // "no usable temperature". They are candidates for stage two, which adds
  // records, not for enrichment, which needs a reading.
  if (tIdx < 4) {
    for (let i = 4; i < vals.length - 1; i++) {
      if (vals[i] === 'null' && vals[i + 1] === 'null') { tIdx = i; break; }
    }
  }
  if (tIdx < 4) return null;
  return {
    state: vals[0],
    lat: vals[1],
    lng: vals[2],
    name: vals.slice(3, tIdx).join(' ').replace(/\s+/g, ' ').trim(),
    tf: vals[tIdx],
    tc: vals[tIdx + 1],
  };
}

const res = await fetch(URL_XLSX, { signal: AbortSignal.timeout(120_000) });
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());

assertHash(buf, SHA256);
console.log(`downloaded ${buf.length} bytes, sha256 verified`);

const files = unzip(buf, ['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
const rows = readSheet(files);

const out = [];
let skipped = 0;
for (const vals of rows) {
  const r = sliceRow(vals);
  if (!r) { skipped++; continue; }
  out.push([r.state, r.lat, r.lng, r.name, r.tf, r.tc].join('\t'));
}

const header = [
  '# NOAA NCEI Thermal Springs List for the United States (1981)',
  `# source:    ${URL_XLSX}`,
  `# doi:       ${DOI}`,
  `# sha256:    ${SHA256}`,
  '# licence:   CC0-1.0 Public Domain Dedication',
  `# retrieved: ${new Date().toISOString().slice(0, 10)}`,
  '# Generated by scripts/fetch-ncei.mjs. Do not edit by hand.',
  ['state', 'lat', 'lng', 'name', 'tf', 'tc'].join('\t'),
].join('\n');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${header}\n${out.join('\n')}\n`);
console.log(`wrote ${OUT} (${out.length} rows, ${skipped} non-data rows skipped)`);
