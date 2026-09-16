# The browser harness in CI: why one workflow may install dependencies

Security design note — 2026-09-16

Companion to [2026-08-25-gate-2-trigger-security.md](2026-08-25-gate-2-trigger-security.md),
which is the threat model this note works inside and does not replace. Read
that first.

## What changed

Until today one rule held for every workflow: **no `npm ci`, no
`npm install`**, enforced by `scripts/workflows.test.mjs`. `npm ci` against a
contributor's lockfile runs their install scripts, and the two gates never
needed a dependency tree, so the rule cost nothing.

The browser harness does need one. It builds the site with Vite and drives it
with Playwright, and neither exists without `node_modules`. So the rule moved,
and it moved on purpose: one named workflow, `.github/workflows/ui.yml`, may
run `npm ci`, and only under conditions a test checks. It is also the first
workflow to run `npm test`. Before it, the suite (674 tests on the day) ran
only on laptops.

The Layer C decision of 2026-09-11 ("a React render harness is declined") was
reversed by Hudson on 2026-09-16. This note covers the CI half of that change.

## Why it is safe enough

The question is not "can a hostile lockfile run code?" It can: with
`--ignore-scripts` it cannot run install scripts, but a dependency's own code
still runs when `npm test` or the build imports it. The question is **what
that code can reach**. In `ui.yml` it reaches nothing worth taking:

- **The trigger is plain `pull_request`.** For a fork, GitHub withholds every
  secret and issues a read-only `GITHUB_TOKEN`. The banned `_target` variant,
  which runs in the base repository's context, stays banned, and a test checks
  that its name appears nowhere under `.github/`.
- **There are no secrets to withhold anyway.** No workflow references one;
  a test says so.
- **The permissions block is `contents: read` and nothing else,** declared
  once at the top level, so no job can widen it.
- **The checkout does not persist credentials,** so the token is not left in
  `.git/config` for a later step, or a dependency, to read.
- **Every external contributor's run waits for a maintainer (F10).** Nothing
  in `ui.yml` runs for a fork until someone clicks approve.
- **It cannot pose as a required check.** The workflow is `ui` and the job
  `browser`. Branch protection requires `validate` and `gate-2 claims`, and
  gate-2 listens for a workflow named `gate-1`. A test forbids all three
  names here.
- **Only gate-2 uses `workflow_run`,** and no workflow downloads an artifact,
  so nothing uploaded by this job is ever read by a privileged one.

What a hostile pull request can still do is waste runner minutes and make
`ui` report whatever it likes. Both were already true of `gate-1`, and the
answer is the same: this check is advisory.

## Cache poisoning: no caches at all

`ui.yml` also runs on `push` to `main`. A compromised dependency in that run
executes in the context of the default branch, and a cache written there is
restored by later runs, including privileged ones. So there is no
`actions/cache` and no `cache:` on setup-node. setup-node v5 turns on npm
caching by default whenever `package.json` exists. The test therefore reads
the pinned major version from the pin's comment and requires
`package-manager-cache: false` from v5 on. The pin is v4 today.

The price is a cold install on every run. Nobody has measured it on a runner
yet; the first runs' logs will show it.

## The report is hostile

The job uploads `playwright-report/` and `test-results/` as an artifact on
every run that is not cancelled. On a fork pull request, **that HTML was
produced by code the contributor controls.** Do not open a fork PR's
Playwright report in a browser session that is signed in to anything. The
job log and the `github` reporter's annotations are plain text and are the
safe place to read a failure.

## Approving a fork's workflow runs

F10 makes approval the one barrier in front of every fork run, so an approval
has to be an actual decision:

1. Read the pull request's **file list** first, not its description.
2. If it touches `.github/`, `package.json`, `package-lock.json`,
   `playwright.config.ts`, `e2e/` or `scripts/`, read those diffs before
   approving. Any of them changes what runs.
3. A data-only pull request (`data/overlay/**`) has no reason to change any
   of them.

## What the workflow test is, and is not

`scripts/workflows.test.mjs` protects **the maintainer from a mistake**: a
careless `cache: npm`, a `pull-requests: write` added to make something work,
an `npx` in a hurry. It does not protect the repository from an attacker. On
a fork pull request the test file comes from the PR head as well, and a
hostile contributor edits it in the same commit. The barriers against an
attacker are the platform's: the unprivileged trigger, the withheld secrets,
F10, and branch protection on `main`.

| The test asserts | Mutation that must fail it |
|---|---|
| `npm install` appears nowhere | add it to `ui.yml` |
| `npm ci` only in `NPM_CI_ALLOWED`, always with `--ignore-scripts` | drop the flag |
| an allowed file: one top-level `permissions: contents: read`, allowed triggers, `persist-credentials: false`, not named `gate-1`, no job `validate` / `gate-2 claims` | add `pull-requests: write` |
| `gate.yml` and `gate-2.yml` run no npm | add `npm test` to gate-2 |
| no `download-artifact` | add it |
| only `gate-2.yml` uses `workflow_run` | add it to `gate.yml` |
| no `actions/cache`, no setup-node `cache:`, v5+ needs `package-manager-cache: false` | add `cache: npm` |
| no `npx` | `npx playwright test` |

Each was applied and watched failing on 2026-09-16. Adding `workflow_run` to
`ui.yml` fails two tests, the allowed-trigger clause and the `workflow_run`
test. So the `workflow_run` test was also checked alone, by adding the trigger
to `gate.yml`.

## Status

**Advisory.** `ui` is not a required check and should not become one until
its flake rate has been measured over real pull requests. `retries: 0` in
`playwright.config.ts` is deliberate: a retry would hide exactly the number
that decision needs. The workflow has no path filters, so it runs on every
pull request, and making it required later will not leave a check pending
forever.
