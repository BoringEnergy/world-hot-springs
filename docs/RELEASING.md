# Releasing a version of the dataset

A release is a git tag, a GitHub release, and -- because Zenodo watches this
repository -- a permanent archive with a DOI. The first two can be deleted.
**The third cannot.** Every step below exists because something in the
archive is for good: its licence, its creator, its files, and any spring that
was in them.

Only the maintainer makes a release, and every outward step is confirmed in
chat before it is taken. An agent prepares the pull requests; it never runs
`gh release create`, never creates a tag, and never pushes one.

What gets archived is generated, not typed: `.zenodo.json` and `CITATION.cff`
come from `src/lib/citation.ts`, `scripts/lib/sources.mjs`,
`data/summary.json` and the top dated entry of [CHANGELOG.md](../CHANGELOG.md),
by `npm run release:meta`. `scripts/citation.test.mjs` rejects a hand edit to
either.

## 1. One-time setup (maintainer)

- GitHub, Settings, Emails: turn on **Block command line pushes that expose
  my email**. History was deliberately not rewritten a second time; this is
  what stops a personal address entering it again.
- Grant the Zenodo OAuth app access to the **BoringEnergy** organisation.
- On zenodo.org, GitHub page: **Sync now**, then switch this repository
  **on** -- before the release is published. Zenodo only archives releases
  published while the switch is on.

## 2. Dry run on the sandbox (recommended before a first or unusual release)

1. Connect `sandbox.zenodo.org` to the fork `HudsonR-D/world-hot-springs`, and
   push the release commit there.
2. Publish a throwaway release on the fork.
3. Read the sandbox record back and check: licence **ODbL**, resource type
   **Dataset**, creator **Hudson R&D**, every related identifier from
   `.zenodo.json`, the notes, the version and the publication date.
4. **Creator type.** `.zenodo.json` has no way to say that a creator is an
   organisation, and Zenodo registers "Hudson R&D" as a *person*. Check
   whether the record's edit screen lets the creator be switched to
   Organisation. If it does, that switch is a step in section 5 for **every**
   version, not a one-off.
5. Delete the fork's release and its tag afterwards.

## 3. Preconditions -- all of them, on the day

- **No pending removal request.** Read the open issues and the private
  contact channel. A spring that enters an archive cannot be taken back out
  of it; the most we can do afterwards is ask Zenodo to restrict the files
  (see [PRIVACY.md](../PRIVACY.md)). A request that is still open means no
  release today.
- **The target commit is green**: the required checks (`validate` and
  `gate-2 claims`) and every other workflow that ran on it.
- **The CHANGELOG date is today's UTC date.** If the release is happening on
  a different UTC date from the one in the top CHANGELOG entry, stop: update
  that date, run `npm run release:meta`, and merge that change first. The
  date is written into the archive explicitly, so a wrong one is permanent.
- **The generated files are current** on the target commit:

  ```bash
  npm run data:build && npm test
  npm run release:meta && git diff --exit-code CITATION.cff .zenodo.json
  ```

- **The archive holds what it should.** The tarball GitHub serves, and Zenodo
  stores, is `git archive` of the tag:

  ```bash
  git archive --format=tar <sha> | tar -t | grep -E '^(\.claude/|data/private/)'   # prints nothing
  ```

## 4. Create the release (only after an explicit yes)

Write the notes from the CHANGELOG entry, not from commit titles:

```bash
node --input-type=module -e "import fs from 'node:fs'; import { latestRelease } from './scripts/build-citation.mjs'; process.stdout.write(latestRelease(fs.readFileSync('CHANGELOG.md', 'utf8')).body + '\n')" > release-notes.md
gh release create vX.Y.Z --target <sha> --title "World Hot Springs X.Y.Z" --notes-file release-notes.md
```

- **Never `--generate-notes`.** The archive's description is the dataset's
  changelog; a list of pull request titles is the site's.
- **Not a prerelease, not a draft.** A citable version is a published,
  stable release; anything else is the wrong signal to an archive that
  cannot be amended.
- **Never `git push --tags`.** `gh release create` makes the one tag the
  release needs. Local tags (a backup from the 2026-08-28 rewrite among them)
  are not for publishing.

## 5. Verify

- Read the new Zenodo record: licence, resource type, creator, related
  identifiers, notes, version, publication date. Fix what the record's edit
  screen allows (metadata can be edited after publication; files cannot).
  Switch the creator to Organisation if section 2 found that possible.
- The DOI resolves at `https://doi.org/<doi>`.
- `gh release view vX.Y.Z` and `git ls-remote --tags origin` show exactly the
  tags that should exist.
- Optionally, set the repository homepage to `https://whs.boring.energy`
  (it still says `world-hot-springs.vercel.app`).

## 6. After the first DOI: wire it in -- done 2026-09-17

This happens once, after the first record has been read back, and it has
happened. What it did, so the shape is recognisable:

- `CONCEPT_DOI` in `src/lib/citation.ts`, and `npm run release:meta`, so
  `CITATION.cff` carries the concept DOI as `doi` and in `identifiers`.
  Only the concept DOI: a release's own version DOI is minted after its files
  are archived, so no file can name it.
- README: a "How to cite" section and a concept-DOI badge.
- `src/lib/seo.ts`: the Dataset JSON-LD gained `identifier` and `sameAs`.
  Not `citation`, which in schema.org lists the works a dataset cites.
- The About panel: a "Cite this dataset" block with a plain doi.org link (no
  badge image, which would add a third-party host).
- The Terms page: the archive caveat beside the removal paragraph, and a new
  `POLICY_UPDATED`.

Later releases need none of this. The concept DOI spans every version, and
Zenodo files each new GitHub release under it by itself.

## If a removal request concerns an archived version

Remove the spring as usual -- live site, repository, every later version.
Then ask Zenodo to restrict access to the affected files of each archived
version that contains it, and record the request and Zenodo's answer. Zenodo
may decline; say so to the person who asked, plainly.

## What has happened so far

**v1.0.0 was released on 2026-09-16**, from `cda3c35`, before this runbook
and before `.zenodo.json` existed. Zenodo therefore built that record from
the CITATION.cff of the day: version DOI `10.5281/zenodo.22800997`, concept
DOI `10.5281/zenodo.22800996`, licence ODbL (correct), but resource type
**Software** and creator **World Hot Springs contributors** -- neither of
which is what was decided. Both are metadata, so both can be corrected in
the record's edit screen, using this repository's `.zenodo.json` as the
reference; the files and the DOI stay as they are. That correction is the
maintainer's to make.

The files cannot be corrected. v1.0.0's archive holds the README, LICENSE
note and docs/DATA.md as they were at `cda3c35` -- the stale US coverage
figures, the OpenStreetMap-only licence note and the three-upstream table
that the next commit fixed. The data in it is right. Whether that is worth a
1.0.1 is the maintainer's call: the versioning policy reserves PATCH for
corrections to records, and these are corrections to the documents that
travel with them.

**Decided 2026-09-16: cut 1.0.1.** The maintainer corrects v1.0.0's type and
creator by hand, and 1.0.1 -- data unchanged, documents corrected, the DOI
wired in -- is released once the harness fixes and the DOI wiring have
merged, so that its archive is right without any hand edits. Its CHANGELOG
entry widens PATCH to cover corrections to the documents that travel with the
records.

**1.0.1 released 2026-09-17**, from `bd73272`, on the maintainer's yes, after
confirming no removal request was pending and with `ui` green on that
commit. Zenodo archived it as version DOI `10.5281/zenodo.22813285` under
the concept `10.5281/zenodo.22800996`, and read back: type **Dataset**,
creator **Hudson R&D**, licence ODbL, published 2026-09-17, all eight related
identifiers present. So `.zenodo.json` works as intended, and the only hand
edit left is v1.0.0's type and creator.

| Version | Tag commit | Version DOI | Archived as |
|---|---|---|---|
| 1.0.0 | `cda3c35` | `10.5281/zenodo.22800997` | Software, "World Hot Springs contributors"; corrected by hand on 2026-09-17 to Dataset, "HudsonR&D" |
| 1.0.1 | `bd73272` | `10.5281/zenodo.22813285` | Dataset, Hudson R&D |
