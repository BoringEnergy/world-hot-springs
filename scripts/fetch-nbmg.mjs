/**
 * Build data/reference/nbmg-spring-chemistry.tsv from the NBMG ArcGIS services.
 *
 *   node scripts/fetch-nbmg.mjs
 *
 * Eight queries, seconds each. Unlike fetch-wqp.mjs this needs no tile grid,
 * no cache and no resumability, because the service answers promptly.
 *
 * A SNAPSHOT, NOT A PINNED DERIVATION, for the same reason WQP is: this is a
 * query service with no published archive, so there is nothing upstream to
 * hash. The MIRROR carries its fetch date and its own sha256, data:build is
 * deterministic from it, and nothing reproduces the fetch. Decided in
 * docs/superpowers/specs/2026-09-11-nbmg-chemistry-spec.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  SERVICES, LAYERS, toRow, toTsv, TSV_COLUMNS, PANEL, NBMG_SOURCE, NBMG_PAGE,
} from './lib/nbmg.mjs';

const BASE = 'https://web2.nbmg.unr.edu/ArcGIS/rest/services/';
const OUT = path.join('data', 'reference', 'nbmg-spring-chemistry.tsv');
const TIMEOUT_MS = 120_000;

async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const rows = [];
const failed = [];
const perService = [];

for (const [state, service] of SERVICES) {
  let meta;
  try {
    meta = await json(`${BASE}${service}/MapServer?f=json`);
  } catch (err) {
    console.error(`  !! ${service}: ${err.message}`);
    failed.push(service);
    continue;
  }
  const layers = (meta.layers ?? []).filter((l) => LAYERS.test(l.name));
  // Utah's service is published with zero layers, and Wyoming's thermal
  // springs service is too. An empty service is a fact about this server, not
  // an error, so it is reported rather than thrown.
  if (!layers.length) {
    console.log(`${state}  ${service}: no panel layers (service is empty)`);
    perService.push(`${state}:0`);
    continue;
  }
  let got = 0;
  for (const layer of layers) {
    let offset = 0;
    for (;;) {
      let page;
      try {
        page = await json(`${BASE}${service}/MapServer/${layer.id}/query`
          + `?where=1%3D1&outFields=*&f=json&resultOffset=${offset}&resultRecordCount=1000`);
      } catch (err) {
        console.error(`  !! ${service}/${layer.name} @${offset}: ${err.message}`);
        failed.push(`${service}/${layer.name}`);
        break;
      }
      const feats = page.features ?? [];
      for (const f of feats) {
        const row = toRow(f.attributes, state);
        if (row) { rows.push(row); got++; }
      }
      offset += feats.length;
      if (feats.length < 1000) break;
    }
  }
  console.log(`${state}  ${service}: ${got} rows carrying a panel value`);
  perService.push(`${state}:${got}`);
}

// Deterministic order, so re-running the fetcher over unchanged upstream data
// produces an identical file and the sha256 means something.
rows.sort((a, b) => a.site.localeCompare(b.site)
  || String(a.measuredAt).localeCompare(String(b.measuredAt))
  || TSV_COLUMNS.map((c) => String(a[c])).join('\t').localeCompare(TSV_COLUMNS.map((c) => String(b[c])).join('\t')));

const body = toTsv(rows);
const sites = new Set(rows.map((r) => r.site)).size;
const counts = PANEL.map((f) => `${f} ${rows.filter((r) => r[f] !== null).length}`).join(', ');
const header = [
  `# ${NBMG_SOURCE}`,
  `# source:    ${NBMG_PAGE}`,
  `# taken:     ${new Date().toISOString().slice(0, 10)}`,
  `# sha256:    ${crypto.createHash('sha256').update(body).digest('hex')}`,
  '# licence:   US state geological survey data, public domain.',
  '# generated: scripts/fetch-nbmg.mjs -- do not edit by hand',
  '#',
  '# A SNAPSHOT, NOT A PINNED DERIVATION. The upstream is a query service',
  '# with no published archive, so there is nothing to hash but this file.',
  '# data:build is reproducible from it; the fetch is not.',
  '#',
  '# Chemistry only. This service also publishes FluidTemperature_C and it is',
  '# NOT read: it yields twelve springs against the atlas and that seam is',
  '# closed, not deferred.',
  '#',
  `# rows:      ${rows.length} across ${sites} sampling sites (${perService.join(', ')})`,
  `# values:    ${counts}`,
  failed.length ? `# INCOMPLETE: ${failed.length} quer(y|ies) failed: ${failed.join(' ')}` : '# complete:  every service answered',
].join('\n');

fs.writeFileSync(OUT, `${header}\n${body}`);
console.log(`\nwrote ${OUT}`);
console.log(`  ${rows.length} rows, ${sites} sites`);
if (failed.length) console.log(`  INCOMPLETE: ${failed.join(' ')}`);
