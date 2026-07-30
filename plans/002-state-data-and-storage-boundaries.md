# Plan 002: State the data and storage boundaries

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1234de6..HEAD -- scripts/summary-path.mjs scripts/generate-summaries.mjs scripts/build-diff-data.mjs scripts/present.mjs scripts/serve-built.mjs app/page.tsx docs/content/data.mdx docs/content/agent-notes.mdx tests/summary-path.test.mjs tests/generate-summaries.test.mjs tests/present-agent.test.mjs tests/present-instances.test.mjs tests/rendered-html.test.mjs tests/serve-built.test.mjs plans/README.md`
> Plan 001 is expected to change several listed files. Compare its final code
> with this plan's required behavior, not only with the excerpts below. Ignore
> status-only edits to `plans/README.md`. Stop on any other unexplained drift.
> Also run `git status --short` and record all pre-existing worktree changes.
> Preserve them throughout this plan.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-make-agent-and-cache-behavior-truthful.md`
- **Category**: docs
- **Planned at**: commit `1234de6`, 2026-07-29
- **Refined after execution STOP**: The first run showed that
  `tests/present-instances.test.mjs` and `tests/rendered-html.test.mjs` seed the
  old repo-local note path. They are direct cache-path fixtures and now belong
  in scope.

## Why this matters

The docs call Diffsplain local and read-only, but they do not say what reaches a
coding agent, which commands use the network, or how long caches remain. The
default worktree run also writes `.diffsplain/summaries.json` inside the target
repo, which can make an unignored checkout dirty. This plan makes the default
run leave the target repo untouched and gives users one exact data contract.

## Current state

- The product brief promises: “Keep local review read-only: the app must not
  change the target repo” (`PRODUCT.md:35`). The landing page repeats
  “Read-only” (`site/index.html:309-312`), though this plan does not edit the
  landing page.
- `scripts/summary-path.mjs` puts default worktree notes in the target repo but
  puts all other target notes in Diffsplain's package cache:

  ```js
  // scripts/summary-path.mjs:16-34
  if (explicit) return resolve(callerDirectory, explicit);
  if (!pr && !branch && !checkout && !(base && head)) {
    return resolve(repo, '.diffsplain/summaries.json');
  }
  // ...
  return resolve(projectRoot, '.cache/summaries', `${target.kind}-${key}.json`);
  ```

- `scripts/generate-summaries.mjs:521-525` creates the note directory and writes
  the JSON file atomically. A default worktree run can therefore create a new
  `.diffsplain/` directory in any target checkout.
- The agent input contains repo and target metadata, the change title/URL,
  a full file overview, selected patches, and completed notes
  (`scripts/generate-summaries.mjs:235-313`). Patches longer than 180,000
  characters become snippets. A batch over 2,000,000 bytes also falls back to
  snippets and then fails if still too large.
- `scripts/generate-summaries.mjs:371-392` tells the agent to use only the
  supplied snapshot. The five provider commands send the data through stdin or
  a temporary JSON file (`scripts/coding-agents.mjs:149-250`).
- The presenter creates a per-run snapshot under the operating system temp
  directory and removes it on normal process exit
  (`scripts/present.mjs:69-81`). The note writer creates another temp directory
  and removes it in `finally` (`scripts/generate-summaries.mjs:710-718`,
  `989-990`).
- Remote branch and pull request runs fetch objects into `.cache/git`
  (`scripts/build-diff-data.mjs:308-337`). Pull request lookup also calls `gh`;
  default-branch discovery can call `git ls-remote`
  (`scripts/build-diff-data.mjs:357-390`).
- The local server binds to `127.0.0.1` and serves the selected snapshot
  (`scripts/serve-built.mjs:145-153`). It pushes Server-Sent Events when the
  file changes (`scripts/serve-built.mjs:110-143`). The page polls every 1.5
  seconds only if EventSource is absent or fails (`app/page.tsx:311-338`).
- `docs/content/data.mdx:52-54` currently says the page always checks the JSON
  every 1.5 seconds.
- `docs/content/agent-notes.mdx:61-81` shows only `change` and `files`. Tool-made
  note files also have `meta`, including fingerprints, state, timestamps, and
  generation settings.
- Follow the atomic JSON write style in
  `scripts/generate-summaries.mjs:521-525` and the temporary-fixture style in
  `tests/summary-path.test.mjs` and `tests/generate-summaries.test.mjs`.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install | `npm ci` | exit 0 |
| Path and note tests | `node --test tests/summary-path.test.mjs tests/generate-summaries.test.mjs tests/present-agent.test.mjs tests/present-instances.test.mjs tests/rendered-html.test.mjs` | all tests pass after `npm run build` |
| Server tests | `node --test tests/serve-built.test.mjs` | all tests pass |
| Docs | `npm run docs:check` | exit 0 |
| Static audit | `npm run fallow:audit` | exit 0, no new findings |
| Lint | `npm run lint` | exit 0 |
| Full tests | `npm test` | exit 0, all tests pass |

## Suggested executor toolkit

- Use the current code as evidence for each data-flow claim. Do not infer a
  provider's own retention or telemetry rules.
- Use the official [npm exec documentation](https://docs.npmjs.com/cli/v11/commands/npm-exec/)
  only for the separate `npx` download/cache statement.

## Scope

**In scope** (the only files you should modify):

- `scripts/summary-path.mjs`
- `scripts/generate-summaries.mjs` (only path migration messages or metadata
  needed by this plan)
- `docs/content/data.mdx`
- `docs/content/agent-notes.mdx`
- `tests/summary-path.test.mjs`
- `tests/generate-summaries.test.mjs`
- `tests/present-agent.test.mjs`
- `tests/present-instances.test.mjs` (only the cached-note fixture)
- `tests/rendered-html.test.mjs` (only the note-file fixture)
- `plans/README.md` (status row only)

**Read for verification, but do not modify**:

- `scripts/build-diff-data.mjs`
- `scripts/present.mjs`
- `scripts/serve-built.mjs`
- `scripts/coding-agents.mjs`
- `app/page.tsx`
- `PRODUCT.md`

**Out of scope** (do not touch):

- Landing-page copy and links; Plan 005 handles them after the docs settle.
- A new global cache policy, cache cleanup command, or operating-system-specific
  cache location.
- Provider account, retention, training, or telemetry claims.
- Encryption of local caches.
- Generated `dist/`, `docs/dist/`, and `docs/.blume/` files.

## Git workflow

- Branch: `codex/002-data-storage-contract`
- Keep the cache-path change and its tests in one commit. Put the docs in a
  second commit if useful.
- Match the repo's short imperative commit style.
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Characterize every note path

Extend `tests/summary-path.test.mjs` before changing the helper. Assert that:

- worktree, checkout, exact range, branch, and pull request targets each get a
  target-specific file under `<projectRoot>/.cache/summaries/`;
- two worktrees in different repos get different paths;
- two targets in the same repo get different paths;
- a relative explicit `--summaries` path still resolves from
  `callerDirectory`;
- no default path sits inside `repo`.

Use the existing 24-character hash suffix and target-kind filename style. Do
not assert a full hash value.

**Verify**:
`node --test tests/summary-path.test.mjs` must fail only because the worktree
path still points at `.diffsplain/summaries.json`.

### Step 2: Move default worktree notes into Diffsplain's cache

Change `summaryPath(...)` so every implicit target, including worktree, builds
the existing target object and hashed cache path. Use:

```js
{ kind: 'worktree' }
```

as the worktree target identity. Keep the repo path in the hash input, as it is
today for other targets. Keep explicit paths unchanged.

Do not copy, delete, or read the old `.diffsplain/summaries.json`
automatically. Silent migration would touch or trust a file in the target repo.
Users who need an old file can pass it through `--summaries FILE`.

Update `tests/present-agent.test.mjs` and any generator test that relied on the
old default path. Pass an explicit fixture-local `--summaries` path in tests
that need to inspect the file; this keeps tests isolated from the repo-level
`.cache/`.

Update the two direct cache fixtures that the first execution exposed:

- In `tests/rendered-html.test.mjs`, put the supplied note file outside the
  target repo and pass it with `--summaries` to each data-builder call.
- In `tests/present-instances.test.mjs`, seed the new hashed implicit worktree
  path for the `--no-agent` cache regression, then remove that cache file in
  cleanup. Do not add `--summaries` to the public `--no-agent` command because
  Plan 001 rejects that conflict.

Add one integration assertion that a default worktree note run:

- writes no `.diffsplain/` directory in the target repo; and
- leaves `git status --porcelain=v1 --untracked-files=all` unchanged apart from
  the test's pre-existing worktree changes.

**Verify**:
`npm run build && node --test tests/summary-path.test.mjs tests/generate-summaries.test.mjs tests/present-agent.test.mjs tests/present-instances.test.mjs tests/rendered-html.test.mjs`
must pass.

### Step 3: Make the data page the main contract

Rewrite `docs/content/data.mdx` around user questions, not source scripts. Keep
the route `/data`. It must include these sections:

1. **What stays local**
   - The page and live snapshot use a loopback server at `127.0.0.1`.
   - Diffsplain has no app-level telemetry in this codebase.
   - Other local processes can reach an open loopback port; do not call it an
     access-control boundary.
2. **What Diffsplain sends**
   - With `--no-agent`, it sends no diff to a coding agent.
   - With notes on, it supplies repo/target metadata, change metadata, the full
     file list, selected unified patches or excerpts, and completed cached
     notes needed for context.
   - State the 180,000-character per-patch and 2,000,000-byte per-batch
     thresholds in plain terms.
   - State that the selected CLI uses its current provider login and policies.
     Do not make claims about provider retention or training.
3. **When the network is used**
   - `npx` may fetch the package into npm's cache.
   - remote branches use Git network access;
   - pull requests use `gh` and Git network access;
   - default-branch discovery may query the configured remote;
   - the selected coding-agent CLI may contact its provider;
   - local exact ranges and worktrees do not need Git network access once the
     package and chosen tools are present.
4. **Files and retention**
   - per-run diff snapshots use an operating-system temp directory and normal
     shutdown removes them;
   - note files persist in `.cache/summaries/`;
   - fetched Git objects persist in `.cache/git/`;
   - agent input/schema temp files normally disappear after each note run;
   - `--summaries`, `--output`, and `--cache-dir` can place data elsewhere;
   - a crash or forced kill can leave temp files.
5. **Live updates**
   - Git state is checked every two seconds;
   - remote targets refresh every 30 seconds;
   - the server pushes an update event after a snapshot write;
   - the page uses 1.5-second polling only as a fallback.
6. **Snapshot and note shape**
   - Keep the concise snapshot field list.
   - Describe `meta` as tool-owned state. List its role without promising that
     every field will remain public.

Link from this page to `/agent-notes` and `/cli` with absolute docs routes.
Source-only build commands will move to the Development page in Plan 005, so
remove them here if that plan has not done so yet.

**Verify**:

```sh
rg -n "127\\.0\\.0\\.1|180,000|2,000,000|30 seconds|Server-Sent|\\.cache/summaries|\\.cache/git|--no-agent" docs/content/data.mdx
! rg -n "page checks the live JSON every 1\\.5 seconds" docs/content/data.mdx
npm run docs:check
```

All commands must exit 0. The negative search must return no matches.

### Step 4: Correct the note-file contract and migration note

Update `docs/content/agent-notes.mdx`:

- replace the worktree `.diffsplain/summaries.json` default with the hashed
  cache rule;
- state that users can still pass any explicit note file with
  `--summaries FILE`;
- add a short migration note: older versions wrote worktree notes under the
  target repo; Diffsplain no longer reads that path by default;
- label the current `change`/`files` sample as the minimum accepted user input;
- show or describe tool-owned `meta` separately, including fingerprints,
  generation state, time, and agent settings;
- warn users not to hand-edit tool-owned `meta`; they may omit it from a
  supplied file.

Keep the JSON sample valid. Do not add internal temp paths to the sample.

**Verify**:

```sh
! rg -n "default to:.*\\.diffsplain|repo/\\.diffsplain" docs/content/agent-notes.mdx
rg -n "minimum|meta|--summaries|older versions|\\.cache/summaries" docs/content/agent-notes.mdx
npm run docs:check
```

All commands must exit 0.

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
may add only the in-scope files and the plan-index status edit.

## Test plan

- Replace the old worktree-path assertion with target-specific cache assertions.
- Add cross-repo and cross-target collision tests.
- Keep explicit-path resolution covered.
- Update live presenter/note fixtures to pass an explicit note path when they
  inspect note JSON.
- Update the rendered HTML fixture to pass its note file explicitly and the
  `--no-agent` presenter fixture to seed the new implicit cache path.
- Add one integration case that proves the default note run does not add a file
  to the target repo.
- Use `tests/summary-path.test.mjs:19-47` for path style and
  `tests/present-agent.test.mjs:47-196` for process cleanup.
- Final focused verification:
  `npm run build && node --test tests/summary-path.test.mjs tests/generate-summaries.test.mjs tests/present-agent.test.mjs tests/present-instances.test.mjs tests/rendered-html.test.mjs tests/serve-built.test.mjs`
  must pass.

## Done criteria

- [ ] No implicit note path resolves inside the target repo.
- [ ] Explicit `--summaries FILE` paths keep their current resolution.
- [ ] A default worktree note run does not create `.diffsplain/` or add a new
      `git status` entry.
- [ ] `/data` states what stays local, what reaches agents, every network path,
      each persistent cache, temp cleanup, and live-update timing.
- [ ] `/agent-notes` distinguishes minimum user input from tool-owned `meta`.
- [ ] The docs make no claim about provider retention, training, or telemetry.
- [ ] `npm run lint`, `npm test`, `npm run docs:check`, and
      `npm run fallow:audit` all exit 0.
- [ ] Compared with the recorded starting status, this plan adds no change
      outside the in-scope list.
- [ ] The plan row in `plans/README.md` says `DONE`.

## STOP conditions

Stop and report back if:

- Plan 001 changed note metadata or `--no-agent` in a way that conflicts with
  this contract.
- The package cache is not writable in a normal packed `npx diffsplain` run.
  Report the failing packed-package test; do not fall back to the target repo.
- Moving worktree notes requires automatic copying or deleting of a user's old
  `.diffsplain` file.
- You cannot support an explicit note path without weakening path handling.
- A docs claim about network or agent input cannot be tied to checked-in code or
  the linked npm documentation.
- A focused or full check fails twice after a reasonable fix attempt.
- The work requires a file outside the in-scope list.
- Fallow reports a new issue that cannot be fixed within this plan. Do not edit
  `.fallowrc.json` or `fallow-baselines/` to hide it.

## Maintenance notes

- If the project later adopts an operating-system cache directory, add a
  migration plan and update every path and retention statement together.
- Any new provider, remote host, telemetry hook, or artifact must update
  `/data` in the same pull request.
- Reviewers should check defaults and explicit overrides separately. The
  read-only claim applies to defaults; a user-chosen `--output` or
  `--summaries` path may point inside a repo.
- Do not promise cleanup after `SIGKILL`, a machine crash, or an abrupt runtime
  stop.
