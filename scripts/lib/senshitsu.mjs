/**
 * 泉質 -> MineralType, fail-closed.
 *
 * AIST publishes Japan's Hot Spring Law classification as free text on 4,184
 * of its 7,203 rows. It looks like an enum and is not: 571 distinct values, of
 * which 359 occur exactly once. What makes it tractable is that the values are
 * COMPOSITIONAL -- 単純硫黄冷鉱泉, Na-Cl・HCO3泉 -- so a token rule covers the
 * one-offs for free, because they are one-off combinations of tokens that
 * recur constantly.
 *
 * The reasoning, the measurements and the rejected alternatives are in
 * docs/superpowers/specs/2026-09-10-senshitsu-mineral-types.md.
 *
 * Why this is strict where the numeric fields are not: `minerals.types` is
 * RISK.high, and overlay.mjs says why -- "acidic and radioactive are members".
 * A wrong potassium misinforms by a few mg/kg. A wrong `acidic` tells someone
 * with the wrong skin that water is safe.
 */
import { canonicalMineralTypes, contestFor } from './overlay.mjs';

/**
 * Token -> classification, LONGEST MATCH FIRST WITHIN EACH GROUP.
 *
 * Ordering is load-bearing rather than tidy. 炭酸水素塩 must be consumed
 * before 炭酸, or every bicarbonate spring also claims carbon dioxide; 塩化物
 * before 塩化 before 食塩; 硫酸塩 before 硫酸 before the sulfur group.
 */
export const TOKENS = [
  // FIRST, and not for tidiness. These are iron with its oxidation state in
  // ROMAN NUMERALS, and they are the reason bare `I` cannot be read as iodine
  // until they are gone: 含Fe(II)-Na-Cl would otherwise classify as iodine,
  // which is not a mistake anything downstream could catch. The spec's token
  // table listed `I` without this guard; the data corrected it.
  ['Fe(III)', 'iron'], ['Fe(II)', 'iron'], ['鉄(III)', 'iron'], ['鉄(II)', 'iron'],
  ['炭酸水素塩', 'bicarbonate'], ['炭酸水素', 'bicarbonate'], ['重炭酸', 'bicarbonate'],
  ['重曹', 'bicarbonate'], ['HCO3', 'bicarbonate'],
  ['硫酸塩', 'sulfate'], ['硫酸', 'sulfate'], ['SO4', 'sulfate'],
  ['芒硝', 'sulfate'], ['石膏', 'sulfate'], ['正苦味', 'sulfate'],
  ['硫化水素', 'sulfur'], ['硫黄', 'sulfur'], ['H2S', 'sulfur'], ['含S', 'sulfur'],
  ['塩化物', 'chloride'], ['塩化', 'chloride'], ['食塩', 'chloride'], ['Cl', 'chloride'],
  ['二酸化炭素', 'carbon-dioxide'], ['炭酸', 'carbon-dioxide'], ['CO2', 'carbon-dioxide'],
  ['放射能', 'radioactive'], ['ラドン', 'radioactive'], ['ラジウム', 'radioactive'], ['Rn', 'radioactive'],
  ['緑礬', 'iron'], ['鉄', 'iron'], ['Fe', 'iron'],
  ['酸性', 'acidic'],
  // Bare `I` is safe only below the Fe(II) rule above, which consumes every
  // Roman numeral this vocabulary uses.
  ['ヨウ素', 'iodine'], ['沃素', 'iodine'], ['I', 'iodine'],
  ['アルミニウム', 'aluminium'], ['明礬', 'aluminium'],
  ['単純', 'simple'],
];

/**
 * Words that are part of a classification's phrasing but name no category:
 * the word "spring" itself, the cations, tonicity and pH qualifiers, and the
 * intensity modifiers. Stripped AFTER the tokens, so 炭酸 is already gone
 * before 酸 could be mistaken for anything.
 */
export const NOISE = [
  '温泉', '冷鉱泉', '冷泉', '鉱泉', '泉',
  'ナトリウム', 'カルシウム', 'マグネシウム', 'カリウム', 'アンモニウム',
  'Na', 'Ca', 'Mg', 'NH4', 'K',
  'アルカリ性', '弱アルカリ性', '弱酸性', '中性', '低張性', '等張性', '高張性',
  '高温', '低温', '含有', '含', '弱', '強', '微', '性', '塩類', '土類', '塩', '類',
  '・', '-', '−', '‐', '―', '(', ')', '（', '）', '、', ',', ' ', '　',
];

/**
 * Read one 泉質 value.
 *
 * @returns {{types: string[], residue: string}} `residue` is whatever this
 *   module could not account for. A non-empty residue means the value is not
 *   fully understood, and the caller MUST publish nothing for that row --
 *   emitting the recognised half would silently drop a classification the
 *   source stated, and an incomplete types array is indistinguishable from a
 *   complete one on the card.
 */
export function classifySenshitsu(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'N/A') return { types: [], residue: '' };

  let rest = raw;
  const found = new Set();
  for (const [token, type] of TOKENS) {
    if (!rest.includes(token)) continue;
    found.add(type);
    rest = rest.split(token).join('');
  }
  for (const word of NOISE) rest = rest.split(word).join('');

  // 単純 is a MODIFIER, not a category, whenever anything else was found.
  //
  // Under the Hot Spring Law the ten 療養泉 classifications are the NAME of
  // the spring and a spring has one. 単純硫黄泉 is not "simple and also
  // sulfur" -- it is a sulfur spring that is otherwise dilute, and its 泉質名
  // is 硫黄泉. Emitting both states one category more than the law does, on a
  // high-risk field, in 16% of what this rule publishes.
  //
  // The rule, and the canonical order, live in overlay.mjs, because an
  // overlay claim writes this same field and must apply the same rule.
  return { types: canonicalMineralTypes(found), residue: rest };
}

/**
 * The whole classification, or nothing.
 *
 * @returns {string[]|null} null when the value is not fully accounted for.
 *   Distinct from `[]`, which means "understood, and names no category".
 */
export function mineralTypesOf(value) {
  const { types, residue } = classifySenshitsu(value);
  if (residue.length > 0) return null;
  return types;
}

/**
 * What the AIST stage does with one spring's 泉質. Pure, so the decision --
 * including the contest a claim would otherwise make silently -- can be tested
 * without running a build.
 *
 * The wells must agree on the RAW string before anything is read from it. Two
 * different classifications under one onsen name are two facts, and
 * reconciling them would publish a name nobody wrote.
 *
 * mineralTypesOf returns null when it could not account for every token. That
 * is not the same as [], and the difference is the whole rule: an incomplete
 * types array is indistinguishable from a complete one on the card, so a value
 * only half understood publishes nothing.
 *
 * An active claim on the field wins (the senshitsu spec, rule 5) -- but not
 * silently. This stage writes nothing for a claimed field, so the overlay
 * would then replace an empty list, and a claim that dropped `acidic` or
 * `radioactive` would leave no trace. So when a value this stage fully
 * understood disagrees with the claim, it returns the contest the overlay
 * cannot see.
 *
 * @param {{springId: string, senshitsu: string[], upstream: string[], claim: {value: string[]}|null}} input
 *   `senshitsu` is the distinct 泉質 strings across the spring's wells, and
 *   `claim` the active claim on minerals.types, if any.
 * @returns {{write: string[]|null, contest: object|null, withheld: string|null}}
 */
export function aistClassification({ springId, senshitsu, upstream, claim }) {
  const none = { write: null, contest: null, withheld: null };
  if (senshitsu.length > 1) return { ...none, withheld: 'wells disagree on 泉質' };
  if (senshitsu.length !== 1 || upstream.length) return none;

  const types = mineralTypesOf(senshitsu[0]);
  if (claim) {
    const contest = types?.length
      ? contestFor(springId, 'minerals.types', types, canonicalMineralTypes(claim.value))
      : null;
    return { ...none, contest };
  }
  if (types === null) {
    return { ...none, withheld: `泉質 not fully understood: ${JSON.stringify(classifySenshitsu(senshitsu[0]).residue)}` };
  }
  return { ...none, write: types.length ? types : null };
}
