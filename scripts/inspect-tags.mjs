/** Ad-hoc: which tag keys actually appear, and how often. Guides the normaliser. */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join('data', 'raw', 'osm');
const counts = new Map();
const tempSamples = [];
let n = 0;

for (const f of fs.readdirSync(dir).filter((x) => x.startsWith('tile-'))) {
  for (const el of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).elements) {
    n++;
    for (const [k, v] of Object.entries(el.tags || {})) {
      counts.set(k, (counts.get(k) || 0) + 1);
      if (/temp/i.test(k) && tempSamples.length < 40) tempSamples.push(`${k}=${v}`);
    }
  }
}

console.log(`${n} elements\n--- top 60 keys ---`);
for (const [k, c] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 60)) {
  console.log(String(c).padStart(6), k);
}
console.log('\n--- temperature-ish samples ---');
console.log(tempSamples.join('\n'));
