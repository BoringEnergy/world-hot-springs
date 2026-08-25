# Gate 2 trigger: threat model and hardened design

Security design note — 2026-08-25, revised after adversarial review

Companion to `2026-08-25-agent-contribution-system-design.md`, decision **D9**.
This is the single most security-sensitive mechanism in the contribution
pipeline: it is where an Anthropic API key leaks if it is wrong.

**Revision note.** The first draft of this document contained a path to the
secret (F1 below) and a false claim about what an attacker can influence. Both
were found by adversarial review before any of it was built. The findings are
kept inline rather than tidied away, because the reasoning that produced the
hole is more useful than the patched result.

## What we are trying to do

Run an LLM reviewer over a contributor's proposed changes to `data/overlay/**`.
The reviewer needs an API key. The contributor is a stranger, often on a fork.

## What the attacker controls

Assume a contributor who is hostile, competent, patient, and has read this
document. On a fork PR they control:

- every file in the PR, **including `.github/workflows/*`**
- the PR title, body, branch name, and commit messages
- the contents of `data/overlay/*.json` — the very text the LLM reads
- how many pushes they make, whether they close and reopen, and the timing
- `package.json` and the lockfile, and therefore any dependency CI would install
- which commit their branch head points at, including commits belonging to other
  PRs in the fork network

They do **not** control anything on the default branch.

**A correction to the first draft.** It claimed: *"The stranger can cause the
workflow to start. They cannot influence what it does."* The second sentence is
false and it is the kind of false that invites bugs. They cannot **execute code**
in it. They influence a great deal of what it does — the head SHA, every byte the
model reads, the trigger rate, and, in the original design, the contents of the
trusted scripts themselves. The accurate statement is:

> A stranger can start the privileged workflow and shape its inputs. They cannot
> execute code inside it, and they cannot reach the key.

Every rule below exists to keep the second sentence true.

## Why `pull_request_target` is banned

It runs in the base repo's context with secrets available while checking out
contributor-controlled content. A modified `prepare` script, a patched test, a
malicious dependency, or an added step all execute with the key in scope.

Forbidden. A test asserts the string does not appear anywhere in `.github/`.

## Why plain `pull_request` cannot do the job either

It withholds secrets from fork PRs unconditionally — including from a `known`
contributor whose trust level is supposed to grant automated review.

And a subtler point: **on a fork PR the workflow file itself comes from the PR
head.** A contributor can rewrite `gate.yml` to report success on anything.
Gate 1's verdict is attacker-controlled and worth nothing as a security input.
It is contributor convenience, not a gate.

## The mechanism: `workflow_run`

Gate 2 triggers on Gate 1's completion. GitHub runs it using **the workflow
definition from the default branch** and grants it secrets. That is the property
`pull_request_target` lacks: the reviewing workflow cannot be edited by the thing
being reviewed. ([Events that trigger
workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows))

This narrows the guarantee the main design document claimed. Under `workflow_run`
a stranger's PR **does** start a privileged workflow. What remains true, and is
sufficient:

> The API key is never reachable from contributor-authored code.

### Rules, all load-bearing

1. **Never check out the PR head.** `actions/checkout` uses the default branch.
2. **Never execute anything from the PR.** No `npm ci` against the PR's lockfile,
   no running its tests, no action at a PR-supplied path.
3. **Never write contributor content into the checkout.** Fetched files go to
   `$RUNNER_TEMP`, named by content hash, never by a path the attacker chose.
   *(This rule did not exist in the first draft. Its absence was the hole.)*
4. **Path-guard the API-derived file list before fetching anything.**
5. **Re-derive every security-relevant fact from the API** — author, head SHA,
   changed files. Never from Gate 1's artifact.
6. **Re-run the deterministic gates** from default-branch code. Gate 1 is
   advisory.
7. **Pin the SHA.** A verdict names the commit reviewed; if the PR moves, it is
   void.
8. **Check trust, idempotency, and budget before spending anything.**
9. **Never write untrusted strings to `$GITHUB_ENV` or `$GITHUB_OUTPUT`,** and
   never interpolate `${{ }}` from event data into a `run:` body. A PR title
   containing a newline can otherwise set `NODE_OPTIONS` and achieve execution in
   the key-bearing step.
10. **Pin every `uses:` to a full commit SHA.** Tags are mutable.

### F1 — the hole in the first draft

The original step order was: fetch changed files → re-validate → run the manager
with the key. The path guard lived inside re-validation, *after* the fetch, and
the document never said where the fetch wrote.

If it wrote files at their repo-relative paths, a PR containing
`scripts/ci/manager.mjs` would overwrite the trusted script in the checkout, and
the next step would execute it with `ANTHROPIC_API_KEY` in the environment. The
design never checked out the head; it just wrote the head's files over the
checkout. Rules 1 and 2 were satisfied in letter and defeated in substance.

Fixed by rules 3 and 4, plus a test asserting the checkout's tracked files are
byte-identical to the default branch immediately before the key-bearing step.

### The `pull_requests` array is empty for forks — and the fix has its own traps

`github.event.workflow_run.pull_requests` is empty for fork PRs, which is
documented. Code reading `pull_requests[0].number` works against same-repo
branches and silently fails for the exact population this design serves.

Resolving by SHA instead introduces three problems the first draft missed
(finding F5):

- `GET /repos/{owner}/{repo}/commits/{sha}/pulls` returns an **array**, and for a
  commit not on the default branch it returns merged *and open* PRs.
- **Fork networks share an object store.** An attacker can point their branch at
  a commit that also heads someone else's open PR. Taking `[0]` could attach a
  *trusted* author to a run the attacker triggered — spending on someone else's
  trust level, with the comment landing on the innocent party's PR.
- Zero results, if the PR closed between gates.

**Required:** accept exactly one open PR whose `head.sha` equals
`workflow_run.head_sha` **and** whose `head.repo.full_name` equals
`workflow_run.head_repository.full_name`. On zero or more than one, label for
human review and exit without spending. Fail closed.

### The path guard can be evaded by volume

`GET /pulls/{n}/files` returns at most 3000 files. A PR touching more hides the
overflow from any guard built on it. Reject outright if the response is at the
cap, or if the changed-file count exceeds **50** — a data-correction atlas has no
legitimate 3000-file pull request.

## Shape of the two workflows

`gate.yml` — untrusted, no secrets, contributor feedback only. Its definition
comes from the PR head and is therefore not trusted for anything.

```yaml
name: gate-1
on: pull_request
permissions:
  contents: read
jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@<pinned-sha>
      - uses: actions/setup-node@<pinned-sha>
        with: { node-version: 24 }
      # No `npm ci`: the validator must not need the PR's dependency tree.
      - run: node scripts/validate-overlay.mjs --changed-only
```

`manager.yml` — trusted. Definition always from the default branch.

```yaml
name: gate-2
on:
  workflow_run:
    workflows: [gate-1]          # matches by NAME, not by file path
    types: [completed]
permissions:
  contents: read
  issues: write                  # comments and labels; NOT pull-requests: write
concurrency:
  group: gate-2-${{ github.event.workflow_run.head_sha }}
  cancel-in-progress: true
jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    if: >
      github.event.workflow_run.event == 'pull_request' &&
      github.event.workflow_run.conclusion == 'success'
    steps:
      # Default branch. Never the PR head.
      - uses: actions/checkout@<pinned-sha>
        with:
          ref: ${{ github.event.repository.default_branch }}

      # SHA -> exactly one open PR, matched on head repo too. Fails closed.
      - id: pr
        env:
          HEAD_SHA: ${{ github.event.workflow_run.head_sha }}
          HEAD_REPO: ${{ github.event.workflow_run.head_repository.full_name }}
          GH_TOKEN: ${{ github.token }}
        run: node scripts/ci/resolve-pr.mjs

      # Path guard runs on the API-derived file list, BEFORE anything is
      # fetched. Rejects >50 files, or a response at the 3000 cap.
      - env: { GH_TOKEN: '${{ github.token }}' }
        run: node scripts/ci/path-guard.mjs

      # Trust, idempotency on (pr, head_sha), and budget. All deterministic,
      # all free, all in default-branch code, all before any model call.
      - id: eligible
        env: { GH_TOKEN: '${{ github.token }}' }
        run: node scripts/ci/check-eligibility.mjs

      - if: steps.eligible.outputs.proceed != 'true'
        env: { GH_TOKEN: '${{ github.token }}' }
        run: node scripts/ci/label.mjs needs-human-review

      # Contributor files land in $RUNNER_TEMP, named by content hash, size
      # capped. Never inside the checkout, never at an attacker-chosen path.
      - if: steps.eligible.outputs.proceed == 'true'
        env: { GH_TOKEN: '${{ github.token }}' }
        run: node scripts/ci/fetch-overlay-diff.mjs

      - if: steps.eligible.outputs.proceed == 'true'
        run: node scripts/validate-overlay.mjs --from-fetched

      # Asserts the checkout still matches the default branch, so nothing
      # above wrote into it. Last line of defence before the key appears.
      - if: steps.eligible.outputs.proceed == 'true'
        run: node scripts/ci/assert-checkout-pristine.mjs

      - if: steps.eligible.outputs.proceed == 'true'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: node scripts/ci/manager.mjs
```

The key appears in exactly one step, last, after every deterministic check.

Two filters that look like controls and are not, worth stating so nobody adds
them thinking they help: `branches:` under `workflow_run` filters the
*triggering* run's branch, which on a fork is an attacker-chosen name. And
`workflows: [gate-1]` matches by workflow **name**, which a contributor can
attach to a different file.

## Prompt injection, and why the containment was insufficient

The manager reads JSON written by strangers. The first draft's containment — no
tools, strict schema, comment and label only, cannot merge — is all true and
none of it constrains the *payload*. Finding F2: the model's `reasoning` is free
text, the attacker wrote its input, and the output is posted by
`github-actions[bot]`, an identity maintainers read as machine ground truth.

What an attacker gets without ever flipping the verdict:

- **Maintainer social engineering.** A confident fabricated citation is the
  maintainer's entire basis for approving.
- **Image-proxy beaconing.** A markdown image in the reasoning is fetched by
  GitHub's camo proxy when the PR is viewed. The model can be induced to encode
  its system prompt into that URL. The key is not in the prompt — but the trust
  policy and risk-tier rules are, and those are what an attacker wants next.
- **Second-order injection** into whatever reads PR comments next: a maintainer's
  own agent session, another bot, a comment-triggered workflow.

And "text attempting to direct the manager is grounds for escalate" is a
judgement made *by the model under attack*. A hope, not a control.

**Required:**

- **Risk tier is computed deterministically** from the diff — which fields
  changed, coordinate delta, whether a new spring is created — in trusted code.
  Never from model output.
- **Treat `reasoning` as hostile on output.** Cap length, strip to plaintext,
  render in a fenced code block, remove links, images, HTML, and `@`/`#`
  references before posting.
- **The model may veto, never authorize.** Auto-merge requires `approve` **and**
  deterministic low-risk **and** a passing deterministic diff check.

## Bounding the spend

Three findings the first draft treated as an accepted residual risk, wrongly.

**Idempotency (F3).** The attacker controls `gate.yml`, so they choose its
trigger types. Adding `reopened` means close-and-reopen fires the whole chain
with no new commit — unlimited spend at two clicks per cycle for a `known`
contributor. Required: a durable ledger keyed on `(pr_number, head_sha)`; on a
hit, re-post the cached verdict and exit before the model call. Plus the
mandatory `concurrency` group above, and a per-author daily call cap.

**Per-call cost (F4).** The budget is checked before the call; nothing bounded
what one call costs. `data/overlay/*.json` is attacker-written and can be
megabytes of *valid* JSON. Required: hard byte cap on fetched content — **reject,
never truncate**, since truncation is itself an injection primitive — explicit
`max_tokens`, and a pre-call token count checked against remaining budget.

**Ledger durability (F8).** With `contents: read` the ledger cannot be a file on
`main`. Actions cache evicts after 7 idle days and is branch-scoped, so idling
the repo resets the budget — a spend attack by itself. Required: name the store.
A GitHub App token with `contents: write` scoped to a single ledger file on a
protected orphan branch, or an external KV with compare-and-swap.

## Two configuration changes worth more than any of the code

**A hard cap on the Anthropic side (F9).** Every control above is on the GitHub
side of the boundary. The strongest available control is on the other side: a
**dedicated Anthropic workspace holding this key, with a hard monthly spend limit
set below the pain threshold**, plus scheduled rotation and spend alerting. It
costs nothing to configure and it converts every finding above from "the owner's
card is drained" to "the reviewer stops working and the owner gets an email."

That this was absent from a document entirely about protecting a key is the most
instructive miss in the review.

**Require approval for all external contributors (F10).** The repository default
is *"Require approval for first-time contributors."* Setting it to **all external
contributors** means no fork PR starts Gate 1 — and therefore no `workflow_run`,
no Gate 2, no spend — without a maintainer click.

Note the interaction, which is the opposite of intuitive: a `known` or `trusted`
contributor has by definition had a PR merged, so the *default* setting no longer
covers them. The default protects precisely the population that already exits in
seconds, and not the population that costs money.

**Turn off "Allow GitHub Actions reviews to count towards required approval"**
at the org level. It is enabled by default, and combined with the permissions
finding below it means a bug in the privileged step could satisfy a branch
protection rule.

## The permissions claim was wrong

The first draft annotated `pull-requests: write` as "comment and label only."
That is false (F7). It also grants `POST /pulls/{n}/reviews` **including
`event: APPROVE`**, `PATCH /pulls/{n}` (retitle, rewrite body, close, reopen),
create PRs, request reviewers, dismiss reviews, `update-branch`, and lock.

Two consequences: the job's token can cast an approving review that satisfies
branch protection; and close/reopen is a self-sustaining trigger loop that
compounds F3.

Corrected above to `issues: write`, which covers issue comments and labels on
pull requests without the review and mutation surface.

## Required tests before this ships

Each maps to a way the design fails.

1. A fork PR from an unknown author produces **zero** model calls, asserted
   against a mocked client. *(Primary token protection.)*
2. A PR that rewrites `gate.yml` to report success is still rejected by Gate 2's
   independent re-validation.
3. A PR touching `scripts/`, `src/`, or `.github/` is rejected by the path guard
   **before** any fetch occurs.
4. **The checkout is byte-identical to the default branch immediately before the
   key-bearing step**, after a PR that includes files at trusted script paths.
5. A verdict is void when the head SHA moves after review.
6. `resolve-pr.mjs` works for a fork PR, where `pull_requests` is empty.
7. `resolve-pr.mjs` **fails closed** when the SHA resolves to zero or to more
   than one open PR.
8. Replaying the same `(pr, head_sha)` re-posts the cached verdict and makes no
   model call.
9. An oversized overlay file is rejected, not truncated, before any model call.
10. Over-budget skips the model call and labels for human review.
11. Model output containing markdown images, links, and `@mentions` is stripped
    before posting.
12. A PR whose changed-file count exceeds 50, or hits the 3000-file API cap, is
    rejected outright.
13. `grep -r pull_request_target .github/` finds nothing.
14. No workflow with secrets in scope obtains PR content by any means — not
    `actions/checkout` at a non-default ref, not `gh pr checkout`, not
    `git fetch origin pull/N/head`, not a `run:` step fetching a tarball.

## Residual risks, accepted knowingly

- **Actions minutes.** A stranger can start short runs. The early exit keeps it
  to seconds; the concurrency group cancels superseded runs. Bounded further by
  the external-contributor approval setting.
- **Third-party actions.** Every `uses:` pinned to a full SHA. An action author's
  compromise would otherwise become ours.
- **A compromised default branch** defeats all of this. That is what branch
  protection and review on `main` are for, and it is out of scope here.

## What was checked and could not be broken

Recorded so the absence of findings means something. Artifact handling — no
`download-artifact`, so the classic poisoned-artifact `workflow_run` attack is
closed. Dependency execution — no `setup-node` or `npm ci` in the trusted
workflow, so no `postinstall` from the PR runs. Direct workflow tampering —
`workflow_run` genuinely pins the definition to the default branch. And
`github.token` carries exactly the declared permissions and no hidden authority;
the problem was that the declaration was broader than intended.
