# 泉質 → MineralType, fail-closed

Written 2026-09-10. Status: recommendation, awaiting a decision. No code.

AIST publishes `泉質`, Japan's Hot Spring Law classification, on 4,184 of its
7,203 rows. `minerals.types` exists and holds exactly that vocabulary. Nothing
in the atlas has ever populated it — **0 records of 7,490 carry a single
type.** This decides whether AIST should, and under what rule.

It is deliberately a spec rather than a lookup, because the work here is the
judgement and the judgement is where this can go quietly wrong.

## Why this field is not like potassium

`minerals.types` is in **`RISK.high`**, alongside `temperature.celsius` and
`clothing.policy`. The test that puts it there gives the reason in five words:
*"acidic and radioactive are members."*

A wrong potassium figure misinforms by a few mg/kg. A wrong `acidic` tells
someone with the wrong skin that water is safe, or that it is not. A wrong
`radioactive` is a health claim about water people drink. That tier is the
whole reason this spec exists and the reason its answer is fail-closed.

## What the data actually says

Measured across all 7,203 rows.

    rows stating a 泉質          4,184        empty        3,019 (42%)
    DISTINCT values               571
    values appearing exactly once 359 of 571 (63%)
    top 30 values cover           66% of the rows that state one

**This is not a small enum with spelling variants.** The handoff called it
"free text with variants" and that undersold it: 63% of the vocabulary occurs
once. A hand-written lookup table would be 571 rows long, most of them
serving a single spring, and it would be stale the moment AIST republishes.

But the values are not arbitrary either. They are *compositional*, built from
a small set of chemical and Japanese tokens:

    単純温泉          Na-Cl泉            単純硫黄冷鉱泉
    アルカリ性単純     Na-Cl・HCO3泉      含塩化土類食塩泉
    放射能泉          Na・Ca-SO4・Cl泉    単純弱放射能冷鉱泉

So the rule should read tokens, not match strings. A token rule covers the
359 one-off values for free, because they are one-off *combinations* of
tokens that recur constantly.

## The rule

**Recognise tokens, strip known noise, and publish only when nothing is
left over.**

Three outcomes per value, and the third is the point:

| Outcome | Meaning | Action |
|---|---|---|
| Every token recognised, ≥1 type | The classification is fully understood | publish |
| Every token recognised, no type | e.g. a pure modifier string | publish nothing, no report |
| **Anything unrecognised remains** | We do not fully understand this value | **publish nothing, and REPORT it** |

The third row is fail-closed and it is not the obvious choice. The tempting
alternative is to emit the types we *did* recognise and ignore the residue —
`含ヨウ素-ナトリウム-塩化物泉` would publish `[chloride]` if `ヨウ素` were
unknown. That is worse than publishing nothing: it silently drops a
classification the source stated, and the record then asserts a *complete*
list that is missing a member. An incomplete `types` array is
indistinguishable from a complete one on the card.

### Tokens, longest match first

Ordering is load-bearing. `炭酸水素塩` must be consumed before `炭酸`, or
every bicarbonate spring also claims carbon dioxide.

    bicarbonate     炭酸水素塩 炭酸水素 重炭酸 重曹 HCO3
    sulfate         硫酸塩 硫酸 SO4 芒硝 石膏 正苦味
    sulfur          硫化水素 硫黄 H2S 含S
    chloride        塩化物 塩化 食塩 Cl
    carbon-dioxide  二酸化炭素 炭酸 CO2
    radioactive     放射能 ラドン ラジウム Rn
    iron            鉄 Fe 緑礬
    acidic          酸性
    iodine          ヨウ素 沃素 I
    aluminium       アルミニウム 明礬 Al
    simple          単純

Noise, carrying no classification: `温泉 冷鉱泉 鉱泉 泉`, the cations
(`ナトリウム カルシウム マグネシウム Na Ca Mg K`), the tonicity and pH
qualifiers (`低張性 等張性 高張性 アルカリ性 中性 弱酸性`), and the
intensity words (`含 弱 強 微 性`).

### The one real judgement: `単純` is a modifier, not a category

Six of the thirty-eight publishable groups hit this, and the naive rule gets
them wrong:

    単純硫黄冷鉱泉        ->  [sulfur, simple]     WRONG
    単純硫化水素放射能泉   ->  [sulfur, radioactive, simple]   WRONG

Under the Hot Spring Law the ten 療養泉 classifications are the *name* of the
spring, and a spring has one. `単純温泉` is the classification when total
dissolved solids sit below 1,000 mg/kg and no component reaches its own
threshold. `単純硫黄泉` is **not** "simple and also sulfur" — it is a sulfur
spring that is otherwise dilute. The 泉質名 is 硫黄泉; `単純` qualifies it.

**Rule: `単純` emits `simple` only when it is the only classification token
present.** With any other category token it is a modifier and is dropped.

This changes no yield — those six records publish either way — but it is the
difference between the card stating what the law states and the card stating
one category too many, on a high-risk field, in 16% of what ships.

Anion lists are the opposite case and genuinely are multiple:
`Na-Cl・HCO3泉` → `[chloride, bicarbonate]` is correct, and the law writes
that name the same way.

## What stays unmappable, permanently

Some values are fully legitimate classifications with **no member in
`MineralType` to hold them**:

    メタケイ酸    66 rows   metasilicic acid
    メタホウ酸    15 rows   metaboric acid
    As           19 rows   arsenic
    ？           12 rows   the source itself is unsure

These are not gaps in the token list; they are gaps in our vocabulary, and
the right response is to keep failing closed on them rather than widen
`MineralType` to chase them. Adding `arsenic` would be a schema change for 19
rows nobody matched, and `？` should never publish anything under any rule.

`法規格該当` ("meets the legal standard", 14 rows) is administrative text
rather than chemistry and stays unrecognised on purpose.

## Measured yield

Against the 78 groups AIST currently matches:

    matched groups                    78
      no 泉質 on any well             32
      wells disagree on 泉質           7   withheld, per the contention rule
      single agreed 泉質              39
         fully accounted, >=1 type    38   <-- would publish
         blocked by an unknown token   1   (As)

**38 records would gain a classification.** The contention rule already in
`aist-match.mjs` governs the 7 disagreements unchanged: wells under one onsen
name genuinely differ, and picking one would publish a classification nobody
stated.

For scale, `minerals.types` currently has 0 records. This is the field going
from empty to populated, which is a different kind of change from moving a
count that already exists.

## Is it worth building?

Yes, with one caveat stated plainly.

**For:** the field already exists, is already rendered, already has a
vocabulary adopted from the Hot Spring Law rather than invented, and is
currently empty on every record in the atlas. 38 records is comparable to a
good country batch, and unlike a country batch it needs no per-spring
research. The token rule is about 40 lines.

**The caveat:** this is the first field where the atlas would *derive* a
classification rather than transcribe a figure. Every other claim in this
project is a number that appears verbatim on the cited page and
`verify-claims.mjs` can check literally. `[sulfur]` does not appear on any
page; `単純硫黄冷鉱泉` does. The mapping is our inference, and no gate can
check it.

That is tolerable here only because the mapping is deterministic, small
enough to read in one screen, fail-closed, and testable against the published
vocabulary — and because the alternative is a field that stays empty forever.
It should be recorded in the record's provenance as AIST-derived, and it must
not be quietly extended later into a heuristic.

## Fail-closed, concretely

1. Any residue after tokens and noise → publish nothing for that row, and
   name the residue in the match report.
2. Wells disagreeing on the raw 泉質 string → publish nothing.
   Never reconcile two classifications.
3. An empty result set is not an error and is not reported.
4. `minerals.types` is never *partially* written: a record gets the whole
   list the value implies, or none of it.
5. A claimed `minerals.types` always wins, as with every other AIST field.

## What is deliberately not decided here

Whether `MineralType` should gain `arsenic`, `metasilicic` or `metaboric`.
Whether the 3,019 rows with no 泉質 could have one inferred from their own
chemistry — they could, and that is a computed classification, which rule 2
forbids for exactly the reason this spec is careful. Whether non-AIST sources
should populate this field. None of those is blocked by this decision.
