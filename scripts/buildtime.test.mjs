import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildTimestamp, buildDate } from './lib/buildtime.mjs';

function fixture(mtimes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whs-buildtime-'));
  mtimes.forEach((iso, i) => {
    const f = path.join(dir, `tile-${i}.json`);
    fs.writeFileSync(f, '{"elements":[]}');
    fs.utimesSync(f, new Date(iso), new Date(iso));
  });
  return dir;
}

test('SOURCE_DATE_EPOCH wins when set', () => {
  const dir = fixture(['2020-01-01T00:00:00Z']);
  assert.equal(buildTimestamp(dir, { SOURCE_DATE_EPOCH: '1756080000' }), '2025-08-25T00:00:00.000Z');
});

test('falls back to the newest input mtime', () => {
  const dir = fixture(['2026-01-01T00:00:00Z', '2026-08-25T04:00:00Z', '2026-03-01T00:00:00Z']);
  assert.equal(buildTimestamp(dir, {}), '2026-08-25T04:00:00.000Z');
});

test('the newest mtime wins regardless of directory order', () => {
  // Guards the fallback against being written as oldest-wins or first-wins:
  // the newest file is created first here, so index order and recency disagree.
  const dir = fixture(['2026-08-25T04:00:00Z', '2026-01-01T00:00:00Z']);
  assert.equal(buildTimestamp(dir, {}), '2026-08-25T04:00:00.000Z');
});

test('the same inputs always produce the same timestamp', () => {
  const dir = fixture(['2026-08-25T04:00:00Z']);
  assert.equal(buildTimestamp(dir, {}), buildTimestamp(dir, {}));
});

test('buildDate is the date half of the timestamp', () => {
  const dir = fixture(['2026-08-25T04:00:00Z']);
  assert.equal(buildDate(dir, {}), '2026-08-25');
});

test('an empty input directory throws rather than silently using now()', () => {
  const dir = fixture([]);
  assert.throws(() => buildTimestamp(dir, {}), /no input files/i);
});

test('files that are not tiles are ignored', () => {
  const dir = fixture(['2026-01-01T00:00:00Z']);
  const stray = path.join(dir, 'osm-fetch.log');
  fs.writeFileSync(stray, 'noise');
  fs.utimesSync(stray, new Date('2026-12-31T00:00:00Z'), new Date('2026-12-31T00:00:00Z'));
  assert.equal(
    buildTimestamp(dir, {}),
    '2026-01-01T00:00:00.000Z',
    'a fetch log written after the tiles must not move the build timestamp',
  );
});

test('a malformed SOURCE_DATE_EPOCH is rejected with a useful message', () => {
  const dir = fixture(['2026-01-01T00:00:00Z']);
  for (const bad of ['not-a-number', '-1', '99999999999999']) {
    assert.throws(
      () => buildTimestamp(dir, { SOURCE_DATE_EPOCH: bad }),
      /SOURCE_DATE_EPOCH must be a Unix timestamp/,
      `${bad} should be rejected`,
    );
  }
});

test('an empty SOURCE_DATE_EPOCH falls through to mtimes rather than throwing', () => {
  // Shells export empty vars readily (`SOURCE_DATE_EPOCH= npm run build`), and
  // that should mean "unset", not "fatal".
  const dir = fixture(['2026-01-01T00:00:00Z']);
  assert.equal(buildTimestamp(dir, { SOURCE_DATE_EPOCH: '' }), '2026-01-01T00:00:00.000Z');
});

test('sub-second mtime precision does not leak into the output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whs-buildtime-'));
  const f = path.join(dir, 'tile-0.json');
  fs.writeFileSync(f, '{"elements":[]}');
  const withMillis = new Date('2026-08-25T04:00:00.777Z');
  fs.utimesSync(f, withMillis, withMillis);
  assert.equal(
    buildTimestamp(dir, {}),
    '2026-08-25T04:00:00.000Z',
    'filesystems disagree on sub-second precision; the output must not',
  );
});
