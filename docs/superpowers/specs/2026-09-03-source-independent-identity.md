# Source-independent identity

Design note — 2026-09-03

Companion to `2026-08-25-agent-contribution-system-design.md`. This is the
blocking dependency for every non-OSM source the product spec already
anticipates: USGS, the Waring survey, national geothermal inventories,
tourism boards. Nothing else in the ingestion roadmap can start until it lands.

**It is also the most dangerous change proposed so far.** Identity is the one
system here where a mistake is both permanent and silent: a wrong id does not
crash, it attaches a correction to the wrong spring, or splits one spring into
two, and it stays that way through every future rebuild. Read this in full
before touching `scripts/lib/identity.mjs`.

## What actually blocks non-OSM sources

Four couplings, verified against the code rather than assumed.

**1. `quality.provenance` is the literal string `'osm'`.** `src/lib/types.ts:96`
declares `provenance: 'osm'` — not a union, a single-member type. A USGS record
cannot describe itself.

**2. `mintId()` takes an OSM ref.** `identity.mjs:94` hashes a bare
`type/id` string:

```js
mintId('node/1078652088') === 'whs_8448a909f48b'   // verified against the live registry
```

**3. `refsOf()` does not merely fail to recognise a non-OSM id — it turns every
one of them into the same merge key.** An earlier draft of this document called
a USGS id "invisible to it". That was wrong, and it was the most dangerous
sentence in the spec.

`refsOf` seeds its set unconditionally, with no guard:

```js
const refs = new Set([osmRefOf(record.id)]);   // identity.mjs:100
```

`osmRefOf` is `id.split('-')`, so `osmRefOf('usgs:P96Q13U3')` returns the
string `'undefined/undefined'`. **Every non-OSM record produces that same ref**,
and `resolveRegistry` matches on refs before anything else. Measured, by
running it:

```
in:  usgs:P96Q13U3 "Alpha"  at (44.6, -110.5)
     usgs:ZZZ999   "Omega"  at (10.0,   20.0)      ~3,000 km apart

out: 1 registry entry, whs_2098f7a355ba
     osmRefs ["undefined/undefined"], name "Omega", centroid [20, 10]
     both records assigned to it
```

Two unrelated springs collapse into one identity, the first one's name and
centroid are overwritten, and `build-dataset.mjs` then stamps both records with
the same `id` — a dataset containing a duplicate primary key. The collision
guard never fires, because this path matches an existing entry and never mints.

This is not a hazard introduced by the change. **It is live behaviour the
moment any record with a non-OSM id reaches `resolveRegistry`**, which is the
first thing every ingestion task in the roadmap does.

**Rule: a record whose id is not OSM-shaped contributes no ref at all.** Never
a synthesised one. `osmRefOf` must return null rather than
`'undefined/undefined'`, and `refsOf` must drop it.

**4. The registry stores `osmRefs`, and only `osmRefs`.** Every entry is
`{osmRefs, centroid, name, firstSeen, lastSeen, missingSince}`.

Those four are the obvious ones. Two more are not obvious, and they are the
reason this document exists rather than a pull request.

## The second hidden coupling: a refless registry entry pretends to be a node

`isSameSpring` is never called against a registry entry directly. It is called
against `asComparable()`, which fabricates an OSM id from the entry:

```js
const ref = entry.osmRefs[0] || 'node/0';      // identity.mjs:168
return { id: `osm-${type}-${num}`, ... };
```

Under the design below, a registry entry sourced only from non-OSM providers
has an **empty** derived `osmRefs`, falls through to `'node/0'`, and is
presented to the matcher as an OSM node. Its feature kind is never unknown — it
is confidently, wrongly, *point*.

That defeats the whole mitigation this spec proposes. Measured:

```
refless unnamed registry entry vs a named OSM way  44 m away  ->  MERGED
refless unnamed registry entry vs a named OSM node 44 m away  ->  separate
```

The concrete wrong merge: an unnamed USGS thermal-sample point 44 m from an OSM
way named "Emerald Pool". Kinds appear to differ, distance is inside
`SAME_FEATURE_METERS`, so they merge — and one real spring is permanently gone
under the other's id. That merge is impossible today only because the USGS
record cannot exist yet.

**The registry entry has nowhere to store a feature kind.** Its shape is
`{osmRefs, centroid, name, firstSeen, lastSeen, missingSince}`. So "records
carry an explicit kind" is only half-implementable: the record side can, the
entry side cannot. Either the entry gains a `kind`, or `asComparable` returns
`kind: 'unknown'` for a refless entry and the branch refuses on unknown. The
second is smaller and is what this spec proposes.

This also makes the known `asComparable` issue in the handoff — that it picks
`osmRefs[0]`, which sorts `node` before `way` — **worse, not unchanged**. The
same line acquires a second and more damaging failure mode.

## The third hidden coupling: matching secretly depends on OSM element types

`isSameSpring()` — the function that decides whether two records are the same
physical spring — has a branch that reads the OSM element type out of the
record id:

```js
// One named, one not: the source-and-pool case, which shows up as two
// different element types.
if (an || bn) {
  return d <= SAME_FEATURE_METERS && osmType(a.id) !== osmType(b.id);
}
```

`osmType` is `id.split('-')[1]`. Measured:

```
osmType('osm-node-123')    -> 'node'
osmType('usgs-sample-9')   -> 'sample'      // works by accident, means something else
osmType('usgs:P96Q13U3')   -> undefined
osmType('whs_abc')         -> undefined
undefined !== undefined    -> false
```

So for two non-OSM records where one is named and one is not, **the branch can
never match**. Not "matches badly" — cannot match, ever. Two records of the
same spring stay separate, both mint ids, and the atlas permanently contains
one spring twice with a correction attached to whichever one the contributor
happened to find.

It fails closed, which is the safer direction and is why nothing has caught it.
But "silently declines to merge" is exactly the failure mode this project has
already been bitten by twice (the six-hex collision, the substring name rule),
and it would arrive at the same moment we start ingesting a source with no
element types at all.

**No generalisation of the registry fixes this.** It lives in the matcher, one
layer below.

## Non-negotiable: existing ids must not change

Every `whs_` id in `data/registry.json` was minted by hashing a **bare** OSM
ref. Namespacing the input changes every one of them:

```
mintId('node/1078652088')      -> whs_8448a909f48b   // what the registry holds
mintId('osm:node/1078652088')  -> whs_917056fb7fd7   // what namespacing would produce
```

A rename is not a cosmetic diff. Every overlay file is named for its spring id
and validated against the published dataset, so renaming ids orphans every
authored claim at once — the only layer in this repository that cannot be
rebuilt.

**Rule: an OSM-derived id is minted from the bare `type/id` string, forever.**
Namespacing applies to new source families only. This is a permanent
compatibility seam, not a transitional one, and it should be stated in code
next to `mintId` and asserted by a test that pins a real id from the committed
registry.

## Design

### `sourceRefs` replaces `osmRefs` as the matching key

```js
{
  provider: 'osm' | 'usgs' | 'nps' | 'wikidata' | 'geonames' | 'manual-seed' | ...,
  externalId: 'node/1078652088',
  url: 'https://www.openstreetmap.org/node/1078652088',
  license: 'ODbL-1.0',
  retrievedAt: '2026-09-03',
}
```

The registry entry gains `sourceRefs` and **keeps `osmRefs`** as a derived
projection (`sourceRefs.filter(r => r.provider === 'osm').map(r => r.externalId)`),
so nothing downstream breaks while it is migrated. Derived, never authored —
two writable copies of the same fact is the divergence that already bit the
price schema.

### Minting

```js
mintId(ref)  // ref is { provider, externalId }
  provider === 'osm'  ->  sha256(externalId)          // bare, unchanged, forever
  otherwise           ->  sha256(`${provider}:${externalId}`)
```

The collision guard at `identity.mjs:225` stays exactly as it is. It throws
rather than conflating two springs, and widening the input space makes it more
load-bearing, not less. Note its error message prints `existing.osmRefs` — for
a non-OSM entry that degrades to an empty string, so the loudest error in the
system loses its evidence exactly when the input space is widest. Print
`sourceRefs`.

**Which ref is minted from must be an explicit rule, not array order.**
`resolveRegistry` mints from `refs[0]` (line 223). Today that is deterministic
only because `refsOf` seeds the set with the record id first. Once a record can
carry several `sourceRefs` — an OSM node that also cites Wikidata, which is
precisely the Jamaica-seed shape this spec cites for provenance — *which* ref
lands at index 0 decides the id, and it would be decided by the order of
`record.sources`, which no contract guarantees.

Rule: **prefer the OSM ref; otherwise the lexicographically lowest
`provider:externalId`.** Deterministic, and it keeps every existing id stable
because OSM always wins where an OSM ref exists.

**The `byRef` index must be namespaced too.** `byRef` (lines 189–191, 253) keys
on bare ref strings. Namespacing `mintId` without namespacing `byRef` produces
the same class of bug as Critical 1: `wikidata:Q4115712` and some other
inventory's bare `Q4115712` would mint *different* ids but collide on the
*same* index key, so the second record resolves onto the first's entry and
never reaches minting. A test that only checks `mintId` passes while the merge
happens.

### Matching, and the element-type branch

`isSameSpring` must stop reading identity out of a string. Records reaching it
should carry an explicit **feature kind** — the thing the OSM element type was
standing in for — rather than an id to be parsed:

- OSM `node` → a point someone mapped as a single feature
- OSM `way`/`relation` → an area
- USGS sample → a point
- unknown → unknown

The existing branch means *"a point and an area at the same place are the
source and its pool; two points are two features"*. Restate it in those terms
and it generalises. **Two records whose kind is unknown must not merge on this
branch** — that preserves the current fail-closed behaviour rather than
quietly inventing a new merge rule for sources we have never ingested.

This is the part to write tests for first and code for second.

### Provenance

`quality.provenance` becomes a union, and — per the research review's
observation about the Jamaica seeds — a record whose *coordinates* come from
OSM while its *thermal evidence* comes from a government tourism page is not
"OSM provenance". The honest minimum is the set of providers that contributed:

```ts
provenance: SourceProvider[]     // was: 'osm'
```

Deriving it from `sourceRefs` keeps it from drifting.

## What this does NOT do

Scope discipline, because this change is dangerous enough on its own:

- **It does not ingest anything.** No USGS, no seeds, no new records. It makes
  ingestion possible and stops there.
- **It does not add `accuracyMeters`, `confidence`, `facilities`, or
  `bathingAllowed`.** Those are additive field work with no identity risk and
  belong in their own change. (`bathingAllowed` already shipped.)
- **It does not touch the privacy filter or its position.**
- **It does not change dedupe thresholds.** `SAME_FEATURE_METERS`,
  `ANONYMOUS_METERS`, `EXACT_NAME_METERS` and `MIN_SUBSTRING_NAME_LENGTH` were
  each measured against the real dataset and cost a defect apiece to arrive at.

## Implementation status

**Both hidden couplings are closed** — `80058dd` and `4d2ec56`, 2026-09-03.
They were live defects independent of this migration, so they landed first.

- `osmRefOf` and `osmType` return `null` for anything not matching
  `/^osm-(node|way|relation)-(\d+)$/`. A non-OSM id contributes no ref, so
  `'undefined/undefined'` can no longer become a universal merge key.
- `asComparable` no longer fabricates `node/0`. A refless entry carries
  `kind: KIND_UNKNOWN`, and the named/unnamed branch refuses when either kind
  is unknown rather than letting `undefined !== 'node'` decide.
- A record with no ref is **refused a durable id and stops the build**, rather
  than minting from its own id. A stopgap mint would produce an id the
  provider-aware `mintId` later moves, and a moving id orphans every overlay
  file named for it — the one outcome this design forbids.

The seam for the rest: `featureKind(record)` is
`record.kind ?? osmType(record.id) ?? KIND_UNKNOWN`. The branch already speaks
in kinds, so the work below changes only what feeds it.

Verified byte-identical across a full rebuild — `hot-springs.json`,
`hot-springs.geojson`, `summary.json` and `registry.json` all unchanged,
`merged 1167 duplicate record(s) -> 6471 springs`, no new events. Neither fix
can reach today's data, because all 6,471 entries hold OSM-shaped refs.

**`sourceRefs` has landed** — `6e90759`, migration steps 1-3.

The registry carries `sourceRefs: [{provider, externalId}]`, and `osmRefs` is
now a *derived projection* of it rather than a second writable copy — the same
one-source-of-truth rule that `access.price` had to be taught the hard way. The
registry deliberately holds only the matching key; the spec's richer
`SourceRef` with `url`, `license` and `retrievedAt` belongs on the record,
because the registry's job is identity and provenance metadata belongs with the
data it describes.

The synthesis lives inside `resolveRegistry`, not at the file boundary. There
turned out to be no loader to teach — `build-dataset.mjs` parses the JSON
inline, and several tests hand-build registries — so normalising at the
boundary would have left both of those paths unmigrated.

All six gates verified independently on a full rebuild: id set identical
(6,471, same order), `hot-springs.json` / `.geojson` / `summary.json`
byte-identical, `merged 1167 duplicate record(s) -> 6471 springs`, zero
`missingSince`, zero events, and stripping `sourceRefs` from the new registry
deep-equals the committed one entry for entry. `mintId('node/1078652088')` is
still `whs_8448a909f48b`.

**Still to do:** the provider-aware `mintId`, the `byRef` namespacing, the
mint-ref selection rule, and widening `quality.provenance`. Those are the steps
where an id can move; this one could not, which is why it went first.

## Migration

The registry is committed, so this is a data migration as much as a code one.

1. **Ship the reader first.** Teach the registry loader to accept an entry with
   only `osmRefs` and synthesise `sourceRefs` from it. No file changes. Every
   existing entry keeps working.
2. **Write both on the next build.** Entries gain `sourceRefs`; `osmRefs`
   continues to be written as the derived projection.
3. **Verify the whole build is unchanged, not just the id set.**

   "If a single id moves, stop" is **not a sufficient check**, and believing it
   was is the kind of error this document exists to prevent. `isSameSpring` has
   two callers, not one: the second is `dedupe()` in `build-dataset.mjs:105`,
   which runs *before* identity resolution and **merges records**, currently
   1,167 of them per build. Widening the matcher widens dedupe.

   A dedupe change moves no ids. It makes a record disappear, which leaves a
   registry entry unmatched, which sets `missingSince` and emits
   `spring.disappeared`. The registry keys stay byte-identical apart from that
   one field — **so the stated check passes while a real spring is silently
   deleted from the published dataset.**

   The check must assert, together:
   - the id set is identical
   - `dedupe` merges exactly as many records as before (the build already
     prints `merged 1167 duplicate record(s) -> 6471 springs`)
   - zero new `missingSince` flags
   - zero `spring.appeared` / `spring.disappeared` events

   Run both builds against the **same pinned `data/raw/`**, back to back.
   `data/raw/` is gitignored, so this cannot run in CI and upstream drift would
   otherwise be indistinguishable from a regression. Anchor the committed test
   (required test 2) to `data/registry.json` and `data/hot-springs.json`, which
   *are* committed.
4. **Only then** generalise `mintId` and the matcher.
5. `osmRefs` stays indefinitely. It costs a line to derive and it is what the
   existing tests, the events log, and any external consumer already read.

## Required tests

Each maps to a way this goes wrong permanently.

1. **A real id from the committed registry still mints identically.** Pin
   `whs_8448a909f48b` from `node/1078652088` as a literal.
2. A full rebuild produces the same id for every spring already in the registry.
3. `mintId` namespaces a non-OSM ref and does not namespace an OSM one.
4. Two different providers with the same `externalId` mint different ids.
5. The collision guard still throws.
6. `osmRefs` on a loaded registry entry equals the OSM subset of `sourceRefs`.
7. An entry with only `osmRefs` — the on-disk shape today — loads and resolves.
8. **A non-OSM record id contributes no ref.** Two non-OSM records far apart
   must produce two registry entries. Today they produce one, keyed
   `'undefined/undefined'` — assert on the ref value, not just the count, or
   the test passes against any other bug that happens to split them.
9. **A refless registry entry never merges on the named/unnamed branch.**

   This is the test most likely to be written wrong, and the spec's earlier
   warning about it was itself inadequate. The tempting version constructs two
   plain objects with explicit `kind` fields and calls `isSameSpring` directly
   — and that **passes while the bug is fully live**, because the defect is in
   `asComparable`, not in `isSameSpring`.

   It must go through `resolveRegistry`, against a registry entry whose
   `osmRefs` are empty, and assert no merge. Verify by reproducing the measured
   result above: a named OSM *way* 44 m away currently merges, a named *node*
   does not.
10. `dedupe` merges the same number of records before and after.
11. Which ref is chosen as mint input, pinned explicitly.
12. Two providers sharing an `externalId` resolve to two entries — through
    `resolveRegistry`, not through `mintId` alone.
13. Nothing in the dedupe thresholds changed: the existing identity tests pass
    untouched.

## The risk that remains after all of this

Widening the matcher widens what can merge. A wrong merge silently deletes a
real spring, and this document proposes making two records that could never
previously be compared eligible to be compared.

The mitigation is the one the codebase already chose: **err toward "no".** The
existing comment on `isSameSpring` says a leftover duplicate is visible and
fixable while a wrong merge is silent, and that judgement should survive this
change unchanged. When a new source's feature kind is unknown, the answer is
"not the same spring" — accept the duplicate, and let a human resolve it.

That is deliberately the more conservative direction than the research review's
framing, which is oriented toward getting more records in. More records is not
the goal. **An atlas that quietly merged two springs would be worse than one
that never grew.**

Two limits on that conservatism, both worth knowing before implementing:

**The grid is built once and never rebuilt**, so a newly minted entry cannot be
matched later in the same build. The reasoning behind that is sound and
survives this change, but it means a fixed named/unnamed branch only merges a
cross-source pair when one side is *already in the registry from a prior
build*. Two records of the same spring arriving from two sources in the same
first build will both mint. A test written as "two fresh records, one build"
will pass at the `isSameSpring` level and fail at `resolveRegistry`.

**`data/overlay/` is currently empty.** The claim that renaming ids "orphans
every authored claim at once" is true in principle, and the bare-ref rule
should be permanent regardless — but today the real blast radius is the
published dataset and any external consumer, not lost corrections. This is the
cheapest moment this change will ever have. That is an argument for doing it
now, not for doing it carelessly.

## Review history

The first draft of this document was adversarially reviewed before any code was
written, and the review inverted its ordering of danger. The draft treated the
`osmType` branch as the buried hazard and described `refsOf` as merely blind to
non-OSM ids. `refsOf` is the one that actively mass-merges: every non-OSM
record resolves to the single key `'undefined/undefined'`, and two springs
3,000 km apart collapse into one entry with the loser's name and centroid
overwritten. Reproduced by running it.

The review also found `asComparable` — absent from the draft entirely — which
renders a refless entry as `osm-node-0` and thereby defeats the draft's own
central mitigation; that `dedupe` is a second caller of the matcher, so the
draft's migration check would have passed while a spring was silently deleted;
that the mint-ref selection rule and the `byRef` index key were both
unspecified; and that the draft's warning about its own most-fragile test was
itself inadequate.

None of this reached code. That is the point of the exercise, and it is the
second time in this project that reviewing a spec before implementing it has
been worth more than any test written afterwards.
