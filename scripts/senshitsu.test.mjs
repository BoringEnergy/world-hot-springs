/**
 * 泉質 -> MineralType.
 *
 * Every test here pins a decision from
 * docs/superpowers/specs/2026-09-10-senshitsu-mineral-types.md, and two of
 * them exist because the obvious rule was wrong on real data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifySenshitsu, mineralTypesOf, TOKENS } from './lib/senshitsu.mjs';
import { FIELD_TYPES } from './lib/overlay.mjs';

test('単純 is a category only when it is the only one', () => {
  // The judgement this rule exists for. Under the Hot Spring Law the ten
  // classifications are the NAME of the spring and a spring has one.
  // 単純硫黄泉 is not "simple and also sulfur" -- it is a sulfur spring that
  // is otherwise dilute, and its 泉質名 is 硫黄泉.
  assert.deepEqual(mineralTypesOf('単純温泉'), ['simple']);
  assert.deepEqual(mineralTypesOf('アルカリ性単純温泉'), ['simple']);
  assert.deepEqual(mineralTypesOf('単純硫黄冷鉱泉'), ['sulfur']);
  assert.deepEqual(mineralTypesOf('単純硫化水素泉'), ['sulfur']);
  assert.deepEqual(mineralTypesOf('単純硫化水素放射能泉'), ['sulfur', 'radioactive']);
  assert.deepEqual(mineralTypesOf('単純炭酸鉄泉'), ['carbon-dioxide', 'iron']);
});

test('an anion list is genuinely several categories', () => {
  // The opposite case, and the law writes these names the same way.
  assert.deepEqual(mineralTypesOf('Na-Cl泉'), ['chloride']);
  assert.deepEqual(mineralTypesOf('Na-Cl・HCO3泉'), ['chloride', 'bicarbonate']);
  assert.deepEqual(mineralTypesOf('Na・Ca-SO4・Cl泉'), ['chloride', 'sulfate']);
});

test('炭酸水素塩 is consumed before 炭酸', () => {
  // Token order is load-bearing, not tidiness. Read the other way round,
  // every bicarbonate spring also claims carbon dioxide.
  assert.deepEqual(mineralTypesOf('炭酸水素塩泉'), ['bicarbonate']);
  assert.ok(!mineralTypesOf('炭酸水素塩泉').includes('carbon-dioxide'));
  // And a real carbon dioxide spring still reads as one.
  assert.deepEqual(mineralTypesOf('二酸化炭素泉'), ['carbon-dioxide']);
});

test('Fe(II) is iron, not iodine', () => {
  // Iron's oxidation state is written in ROMAN NUMERALS, so bare `I` cannot
  // be read as iodine until those are consumed. The spec's token table listed
  // `I` without this guard; four distinct published values corrected it, and
  // nothing downstream could have caught the mistake.
  assert.deepEqual(mineralTypesOf('含Fe(II)-Na-Cl'), ['chloride', 'iron']);
  assert.deepEqual(mineralTypesOf('含鉄(II)・弱放射能-ナトリウム・カルシウム-塩化物泉'),
    ['chloride', 'iron', 'radioactive']);
  // Bare I really is iodine once they are gone.
  assert.deepEqual(mineralTypesOf('含I'), ['iodine']);
  assert.deepEqual(mineralTypesOf('含I・CO2'), ['carbon-dioxide', 'iodine']);
  // The guard must sit ahead of the iodine token, or the above is luck.
  const ironAt = TOKENS.findIndex(([t]) => t === 'Fe(II)');
  const iodineAt = TOKENS.findIndex(([t]) => t === 'I');
  assert.ok(ironAt >= 0 && iodineAt > ironAt, 'Fe(II) must be consumed before bare I');
});

test('a value we do not fully understand publishes nothing', () => {
  // null and [] are different answers. null is "not understood, withhold";
  // [] is "understood, names no category". Emitting the recognised half of an
  // unknown value would silently drop a classification the source stated, and
  // an incomplete list is indistinguishable from a complete one on the card.
  assert.equal(mineralTypesOf('メタケイ酸'), null);
  assert.equal(mineralTypesOf('メタホウ酸'), null);
  assert.equal(mineralTypesOf('含As'), null);
  assert.equal(mineralTypesOf('？'), null);
  assert.equal(mineralTypesOf('法規格該当'), null);
  // Absent is not a failure.
  assert.deepEqual(mineralTypesOf(''), []);
  assert.deepEqual(mineralTypesOf('N/A'), []);
  assert.deepEqual(mineralTypesOf(null), []);
});

test('the residue names what was not understood', () => {
  // The report has to say WHY a row was withheld, or the blocked set is a
  // number nobody can act on.
  assert.equal(classifySenshitsu('含As').residue, 'As');
  assert.equal(classifySenshitsu('メタケイ酸').residue, 'メタケイ酸');
  assert.equal(classifySenshitsu('単純温泉').residue, '');
});

test('every published classification is in the declared vocabulary', () => {
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const allowed = new Set(FIELD_TYPES['minerals.types']);
  const bad = [];
  for (const s of all) for (const t of s.minerals.types) if (!allowed.has(t)) bad.push([s.id, t]);
  assert.deepEqual(bad, [], 'a type outside MineralType reached the dataset');
});

test('no shipped record carries simple alongside another category', () => {
  // The data half of the 単純 rule. Six of the thirty-eight would have.
  const all = JSON.parse(fs.readFileSync('data/hot-springs.json', 'utf8'));
  const both = all.filter((s) => s.minerals.types.includes('simple') && s.minerals.types.length > 1);
  assert.deepEqual(both.map((s) => s.id), []);
  // Not vacuous: the field really is populated now, having been empty on all
  // 7,490 records before this.
  assert.ok(all.filter((s) => s.minerals.types.length > 0).length > 30);
});
