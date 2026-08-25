import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appendEvents, readEvents } from './lib/events.mjs';

function tmpfile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'whs-events-')), 'events.jsonl');
}

const contested = (to) => ({
  type: 'claim.contested', springId: 'whs_a1b2c3d4e5f6',
  claimPath: 'temperature.celsius', from: 42, to, actor: 'build',
});

test('events are written one JSON object per line', () => {
  const f = tmpfile();
  appendEvents(f, [contested(38)], '2026-08-25T04:00:00.000Z');
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).ts, '2026-08-25T04:00:00.000Z');
});

test('re-running the same build does not duplicate events', () => {
  const f = tmpfile();
  appendEvents(f, [contested(38)], '2026-08-25T04:00:00.000Z');
  appendEvents(f, [contested(38)], '2026-08-25T04:00:00.000Z');
  assert.equal(readEvents(f).length, 1, 'a rebuild must not grow the log');
});

test('a genuinely new state for the same claim is recorded', () => {
  const f = tmpfile();
  appendEvents(f, [contested(38)], '2026-08-25T04:00:00.000Z');
  appendEvents(f, [contested(45)], '2026-09-01T04:00:00.000Z');
  assert.equal(readEvents(f).length, 2);
});

test('upstream drifting while the claim is unchanged is not news', () => {
  // 42 -> 43 upstream with the claim still at 38 is the same unresolved
  // disagreement. Re-reporting it every time a mapper nudges the value would
  // bury the log in noise.
  const f = tmpfile();
  appendEvents(f, [{ ...contested(38), from: 42 }], '2026-08-25T04:00:00.000Z');
  appendEvents(f, [{ ...contested(38), from: 43 }], '2026-09-01T04:00:00.000Z');
  assert.equal(readEvents(f).length, 1);
});

test('the same state emitted twice within one batch is written once', () => {
  const f = tmpfile();
  appendEvents(f, [contested(38), contested(38)], '2026-08-25T04:00:00.000Z');
  assert.equal(readEvents(f).length, 1);
});

test('history is never rewritten', () => {
  const f = tmpfile();
  appendEvents(f, [contested(38)], '2026-08-25T04:00:00.000Z');
  const before = fs.readFileSync(f, 'utf8');
  appendEvents(f, [contested(45)], '2026-09-01T04:00:00.000Z');
  assert.ok(fs.readFileSync(f, 'utf8').startsWith(before), 'existing lines must be untouched');
});

test('appendEvents reports how many it wrote', () => {
  const f = tmpfile();
  assert.equal(appendEvents(f, [contested(38)], '2026-08-25T04:00:00.000Z'), 1);
  assert.equal(appendEvents(f, [contested(38)], '2026-08-25T04:00:00.000Z'), 0);
  assert.equal(appendEvents(f, [], '2026-08-25T04:00:00.000Z'), 0);
});

test('events of different types on one claim are distinct', () => {
  const f = tmpfile();
  appendEvents(f, [
    { type: 'claim.contested', springId: 'whs_a1b2c3d4e5f6', claimPath: 'x', to: 1, actor: 'build' },
    { type: 'claim.reaffirmed', springId: 'whs_a1b2c3d4e5f6', claimPath: 'x', to: 1, actor: 'build' },
  ], '2026-08-25T04:00:00.000Z');
  assert.equal(readEvents(f).length, 2);
});

test('readEvents on a missing file is empty, not an error', () => {
  assert.deepEqual(readEvents(path.join(os.tmpdir(), 'whs-nope', 'events.jsonl')), []);
});

test('a corrupt line fails loudly rather than being skipped', () => {
  const f = tmpfile();
  fs.writeFileSync(f, '{"type":"ok"}\nnot json\n');
  assert.throws(() => readEvents(f), /line 2/);
});
