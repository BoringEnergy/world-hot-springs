/**
 * Every key the site writes to the device is declared in one place.
 *
 * src/lib/storage.ts is the list the privacy page renders. A key typed as a
 * literal anywhere else is a key the page may not mention -- which is how the
 * page came to call the unit preference "the only thing this site writes"
 * while the welcome panel wrote a second key (D5, found by the browser
 * harness). e2e/disclosure.spec.ts checks a real visit against the rendered
 * page; this is the fast first line, and it names the file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STORAGE_KEYS } from '../src/lib/storage.ts';

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
}

const STORAGE_FILE = path.join('src', 'lib', 'storage.ts');

test('storage keys are string literals only in lib/storage.ts', () => {
  const keys = STORAGE_KEYS.map((s) => s.key);
  assert.ok(keys.length > 0, 'storage.ts declares no keys');
  for (const file of sources('src')) {
    if (file === STORAGE_FILE) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const key of keys) {
      assert.ok(!text.includes(`'${key}'`) && !text.includes(`"${key}"`), `${file} types the key ${key}; import it from lib/storage.ts`);
    }
  }
});

test('nothing outside lib/storage.ts hands web storage a literal key', () => {
  // A new key has to be added to the list the privacy page renders first.
  const literal = /\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*['"`]/;
  for (const file of sources('src')) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, literal, `${file} passes a literal key to web storage; declare it in lib/storage.ts`);
  }
});

test('every declared key says what it is for', () => {
  for (const s of STORAGE_KEYS) {
    assert.match(s.key, /^whs\.[a-z]+$/, `${s.key} is not in the site's key namespace`);
    assert.ok(s.title.trim() && s.purpose.trim(), `${s.key} has no plain-language purpose for the privacy page`);
  }
  assert.equal(new Set(STORAGE_KEYS.map((s) => s.key)).size, STORAGE_KEYS.length, 'a key is declared twice');
});
