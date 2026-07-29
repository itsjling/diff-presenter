# Plan 004: Define every review target exactly

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1234de6..HEAD -- README.md docs/content/index.mdx docs/content/cli.mdx tests/cli-args.test.mjs tests/remote-targets.test.mjs plans/README.md`
> Plan 001 may change these docs and parser tests. Compare its final state with
> the facts below. Ignore status-only edits to `plans/README.md`. Stop on any
> other unexplained mismatch.
> Also run `git status --short` and record all pre-existing worktree changes.
> Preserve them throughout this plan.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-make-agent-and-cache-behavior-truthful.md`
- **Category**: docs
- **Planned at**: commit `1234de6`, 2026-07-29

## Why this matters

Users can choose five review targets, but the docs do not put their Git
semantics side by side. “Compare with the default branch” can mean either a
direct tip-to-tip diff or a merge-base diff, and users need to know whether
staged, unstaged, or untracked files appear. This plan adds a target matrix and
runtime tests for each row.

## Current state

- With no public target, `scripts/cli-args.mjs:245-254` passes the internal
  `--checkout` target.
- Checkout resolution finds the default branch, calculates one unique merge
  base with current `HEAD`, and uses a one-argument Git diff:

  ```js
  // scripts/build-diff-data.mjs:620-651
  const defaultBranch = localDefaultBranch(remote);
  const defaultHead = localBaseCommit(defaultBranch, remote);
  const mergeBaseOid = uniqueMergeBase(runRepo, defaultHead, currentHead);
  // ...
  range: [mergeBaseOid],
  base: mergeBaseOid,
  head: currentHead,
  ```

  A one-argument `git diff <merge-base>` compares that commit with the current
  worktree, so it includes local commits, staged work, and unstaged work.
  `scripts/build-diff-data.mjs:817-833` adds untracked files for checkout and
  worktree targets.

- `--worktree` resolves to `git diff HEAD` (or the empty tree before the first
  commit) and adds untracked files (`scripts/build-diff-data.mjs:663-700`). It
  excludes earlier local commits because `HEAD` is its base.
- `--base REF --head REF` passes two resolved commits to Git
  (`scripts/build-diff-data.mjs:669-698`). It compares those exact commit trees
  and ignores the current index, worktree, and untracked files.
- A remote branch fetches base and head tips into a separate bare cache, then
  diffs merge-base to branch head (`scripts/build-diff-data.mjs:491-538`).
- A pull request gets metadata from `gh`, fetches base and PR head into that
  cache, then diffs merge-base to PR head
  (`scripts/build-diff-data.mjs:541-617`).
- The watcher checks local state every two seconds and refreshes remote targets
  every 30 seconds (`scripts/build-diff-data.mjs:1015-1027`).
- Default-branch lookup prefers the remote-tracking symbolic `HEAD`, may query
  the remote with `ls-remote`, then falls back to configured/main/master local
  branches (`scripts/build-diff-data.mjs:357-419`). It does not fetch a missing
  default-branch commit into the checkout.
- `docs/content/cli.mdx` gives each target its own section, but no compact matrix
  covers comparison point, local changes, network, and refresh together.
- `tests/remote-targets.test.mjs:103-128` proves checkout includes a local commit
  and one untracked file. Lines 74-101 and 163-208 prove branch/PR reads do not
  change checkout state. No test cleanly contrasts checkout, worktree, and exact
  range with the same fixture.
- Use the temporary bare-remote fixture and `checkoutState(...)` helper in
  `tests/remote-targets.test.mjs:26-72`. Do not add a Git test library.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install | `npm ci` | exit 0 |
| Target tests | `node --test tests/cli-args.test.mjs tests/remote-targets.test.mjs` | all tests pass |
| Docs | `npm run docs:check` | exit 0 |
| Static audit | `npm run fallow:audit` | exit 0, no new findings |
| Lint | `npm run lint` | exit 0 |
| Full tests | `npm test` | exit 0, all tests pass |

## Scope

**In scope** (the only files you should modify):

- `README.md`
- `docs/content/index.mdx`
- `docs/content/cli.mdx`
- `tests/cli-args.test.mjs`
- `tests/remote-targets.test.mjs`
- `plans/README.md` (status row only)

**Read for verification, but do not modify**:

- `scripts/cli-args.mjs`
- `scripts/build-diff-data.mjs`

**Out of scope** (do not touch):

- Changing any target's Git behavior. If characterization tests disagree with
  this plan, stop and report a separate behavior bug.
- Adding target aliases or exposing the internal `--checkout` flag.
- Cache/storage prose beyond what the matrix needs; Plan 002 covers that detail.
- Full option/reference work; Plan 007 covers it.
- Generated `dist/`, `docs/dist/`, and `docs/.blume/` files.

## Git workflow

- Branch: `codex/004-review-target-contract`
- Commit characterization tests before or with the docs they support.
- Match the repo's short imperative commit style.
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Characterize local target differences

Expand the remote-target fixture or add a focused local fixture in
`tests/remote-targets.test.mjs`. Start from one default-branch commit, create a
feature branch, and then create:

- one committed feature file;
- one staged file;
- one unstaged tracked edit;
- one untracked file.

Run the builder three ways and assert exact path sets:

1. `--checkout`: includes all four forms of work since the merge base.
2. `--worktree`: includes staged, unstaged, and untracked files but not the
   committed feature file.
3. `--base <base-oid> --head HEAD`: includes the committed feature file but none
   of the three current workspace-only changes.

Also assert `repo.target.kind`, `repo.base`, and `repo.head` for each result.
Keep fixture signing disabled like the existing setup.

**Verify**:
`node --test tests/remote-targets.test.mjs` must pass and contain distinct
checkout, worktree, and range cases.

### Step 2: Complete remote and conflict characterization

Keep and tighten the existing remote assertions:

- The branch and PR fixture has a base-branch-only commit after the branches
  split. Continue asserting that the output contains only `feature.txt`; this
  proves merge-base comparison rather than direct tip-to-tip comparison.
- Assert `repo.target.mergeBaseOid` for branch and PR output.
- Assert the branch and PR operations leave `HEAD`, branch, status, index,
  refs, and `FETCH_HEAD` unchanged.
- Add a table-driven parser test in `tests/cli-args.test.mjs` for every invalid
  pair:
  - `--branch` + `--pr`;
  - `--pr` + `--base` or `--head`;
  - `--branch` + `--head`;
  - `--worktree` + any other target;
  - only one of `--base`/`--head`;
  - remote repo with neither `--branch` nor `--pr`.

Do not loosen accepted combinations.

**Verify**:
`node --test tests/cli-args.test.mjs tests/remote-targets.test.mjs` must pass.

### Step 3: Add one target matrix

Place a target matrix near the top of `docs/content/cli.mdx`, before the
target-specific examples. Use these columns:

| Target | Command shape | Comparison | Includes workspace changes | Network/cache | Refresh |
| --- | --- | --- | --- | --- | --- |

The rows must say:

- **Current checkout**: no target flag; merge base of default-branch tip and
  current `HEAD` through the current worktree; includes local commits, staged,
  unstaged, and untracked files; may query the remote only to discover its
  default branch; local state checked every two seconds.
- **Worktree**: `--worktree`; `HEAD` through current worktree; includes staged,
  unstaged, and untracked files but not prior local commits; no Git network;
  local state checked every two seconds.
- **Exact range**: `--base REF --head REF`; direct base commit through head
  commit; ignores current index/worktree/untracked files; no Git network; moved
  refs checked every two seconds.
- **Remote branch**: `--branch NAME`; merge base of remote base/head tips
  through remote branch head; no local workspace changes; Git network and bare
  cache; remote refresh every 30 seconds.
- **Pull request**: `--pr NUMBER|URL`; merge base of PR base/head tips through
  PR head; no local workspace changes; `gh`, Git network, and bare cache; remote
  refresh every 30 seconds.

Below the matrix, explain:

- how the default branch is found;
- that the default branch commit must already exist locally for checkout mode;
- that `--remote NAME|URL` defaults to `origin`;
- that a remote repo URL or `owner/repo` needs `--branch` or `--pr`;
- that branch/PR reads do not switch or change the local checkout.

Keep the existing examples, but remove prose that repeats a full matrix row.

**Verify**:

```sh
rg -n "Current checkout|Worktree|Exact range|Remote branch|Pull request|merge base|staged|unstaged|untracked|30 seconds|two seconds" docs/content/cli.mdx
npm run docs:check
```

Both commands must exit 0.

### Step 4: Keep the Introduction and README short

Update `docs/content/index.mdx` with one sentence that defines the no-argument
review as merge-base-to-worktree and links to `/cli` for the matrix.

In `README.md`, keep the command table compact. Correct these rows if needed:

- no arguments: default branch split point through current checkout;
- `--worktree`: workspace-only changes against `HEAD`;
- `--base`/`--head`: exact commit range;
- branch and PR: remote merge-base review.

Do not copy the six-column matrix into the README.

**Verify**:

```sh
rg -n "merge base|split|worktree|exact" README.md docs/content/index.mdx
npm run docs:check
```

Both commands must exit 0.

### Step 5: Run all repository checks

**Verify**:

```sh
npm run lint
npm test
npm run docs:check
npm run fallow:audit
git status --short
```

All checks must pass. Compare Git status with the starting snapshot. This plan
may add only in-scope files and the plan-index status edit.

## Test plan

- Add one local fixture with committed, staged, unstaged, and untracked work.
- Assert exact file sets for checkout, worktree, and exact range.
- Keep branch and PR merge-base behavior covered with the diverged remote
  fixture.
- Add all public target conflicts as table-driven parser cases.
- Model Git setup and teardown after
  `tests/remote-targets.test.mjs:26-72`.
- Final focused verification:
  `node --test tests/cli-args.test.mjs tests/remote-targets.test.mjs` must pass.

## Done criteria

- [ ] One matrix states comparison points, workspace inclusion, network/cache,
      and refresh for all five targets.
- [ ] Checkout, worktree, and exact range have distinct regression tests with
      exact file sets.
- [ ] Branch and PR tests prove merge-base behavior and unchanged checkout
      state.
- [ ] All invalid target pairs have parser tests.
- [ ] The Introduction and README use short wording that agrees with the matrix.
- [ ] No docs page exposes internal `--checkout`.
- [ ] `npm run lint`, `npm test`, `npm run docs:check`, and
      `npm run fallow:audit` all exit 0.
- [ ] Compared with the recorded starting status, this plan adds no change
      outside the in-scope list.
- [ ] The plan row in `plans/README.md` says `DONE`.

## STOP conditions

Stop and report back if:

- A characterization test shows runtime behavior that differs from any required
  matrix row.
- Correcting that behavior would require editing `scripts/cli-args.mjs` or
  `scripts/build-diff-data.mjs`; this plan documents and tests, but does not
  change target semantics.
- Plan 001 changed target parsing or Plan 002 changed remote refresh behavior.
- Git behaves differently on a supported platform and the test needs
  platform-specific source logic.
- A focused or full check fails twice after a reasonable fix attempt.
- The work requires a file outside the in-scope list.
- Fallow reports a new issue that cannot be fixed within this plan. Do not edit
  `.fallowrc.json` or `fallow-baselines/` to hide it.

## Maintenance notes

- Any future target must add a matrix row and an exact path-set test in the same
  change.
- Reviewers should check the words “merge base,” “tip,” “HEAD,” and “worktree.”
  Replacing one with a vague “compare to branch” can change the meaning.
- If refresh intervals become configurable, the matrix should link to the
  option rather than hard-code duplicated defaults.
