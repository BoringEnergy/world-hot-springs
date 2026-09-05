/**
 * Is this checkout still the default branch, byte for byte?
 *
 * The last thing checked before a key exists in the environment, and the
 * answer to finding F1 -- the hole in the security spec's own first draft.
 *
 * F1: the original step order was fetch contributor files, then re-validate,
 * then run the key-bearing manager. Nothing said where the fetch wrote. If it
 * wrote files at their repo-relative paths, a pull request containing
 * `scripts/ci/manager.mjs` would overwrite the trusted script in the checkout,
 * and the next step would execute it with the key in scope. The workflow
 * never checked out the head; it just wrote the head's files over the
 * checkout. Rules 1 and 2 were satisfied in letter and defeated in substance.
 *
 * fetch-contrib.mjs is what makes that not happen. This is what proves it did
 * not happen -- belt and braces, because the cost of being wrong is the key.
 *
 * Uses git rather than a hash manifest: `git status --porcelain` reports
 * modifications, additions and deletions against the tree that was checked
 * out, which is exactly the question, and it cannot be fooled by a file whose
 * mtime was preserved.
 */

/**
 * @param {object} deps
 * @param {(args: string[]) => string} deps.git  run git, return stdout
 * @param {string} deps.expectedRef              the ref that should be checked out
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function assertPristine({ git, expectedRef }) {
  // Untracked files are included (`--porcelain` shows them as `??`). A
  // contributor file dropped into the checkout at a path nothing tracks is
  // exactly the attack, and ignoring untracked entries would miss it.
  let status;
  try {
    status = git(['status', '--porcelain', '--untracked-files=all']).trim();
  } catch (err) {
    return { ok: false, reason: `could not read git status: ${err.message}` };
  }
  if (status) {
    return {
      ok: false,
      reason: `the checkout has been modified since it was created:\n${status}`,
    };
  }

  // And that it is the ref we meant. A clean tree at the wrong commit is
  // still the wrong code, and `ref:` in the workflow is only as good as the
  // event payload that filled it.
  let head;
  try {
    head = git(['rev-parse', 'HEAD']).trim();
    const want = git(['rev-parse', expectedRef]).trim();
    if (head !== want) {
      return { ok: false, reason: `HEAD is ${head}, expected ${expectedRef} at ${want}` };
    }
  } catch (err) {
    return { ok: false, reason: `could not resolve ${expectedRef}: ${err.message}` };
  }

  return { ok: true };
}
