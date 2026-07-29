# Plan 001: Make agent flags and note cache behavior truthful

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8703ca8..HEAD -- scripts/cli-args.mjs scripts/coding-agents.mjs scripts/present.mjs scripts/build-diff-data.mjs scripts/generate-summaries.mjs README.md docs/content/index.mdx docs/content/cli.mdx docs/content/agent-notes.mdx tests/cli-args.test.mjs tests/coding-agents.test.mjs tests/generate-summaries.test.mjs tests/present-instances.test.mjs plans/README.md`
> If any source or docs file in that list changed since this plan was written,
> compare the "Current state" excerpts with the live files before proceeding.
> Ignore status-only edits to `plans/README.md`. Treat any other mismatch as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `8703ca8`, 2026-07-29

## Why this matters

Three public promises do not match the command. `--no-agent` can still show
cached notes, `--reasoning` silently does nothing for three agents, and changing
the agent or model can reuse notes from the old setting. These gaps make privacy
choices and note provenance hard to trust. This plan makes the flags explicit
and ties every cached note to the agent settings that made it.

## Current state

- `scripts/cli-args.mjs` parses the public command. It records whether note
  generation is on, but it does not tell the data writer to ignore old notes:

  ```js
  // scripts/cli-args.mjs:315-325
  return {
    help: false,
    version: false,
    agentEnabled: !noAgent,
    agent,
    codexBin: options.get('--codex-bin'),
    feedArgs: commonArgs,
    agentArgs,
    port: Number(portValue),
    portWasPassed: options.has('--port'),
    forceSummaryRegeneration: options.has('--force'),
  };
  ```

- `scripts/present.mjs` skips the note writer when `agentEnabled` is false, but
  it starts the same data writer:

  ```js
  // scripts/present.mjs:83-90
  if (!feedArgs.includes('--watch')) feedArgs.push('--watch');
  const outputPath = resolve(
    callerDirectory,
    feedArgs[feedArgs.indexOf('--output') + 1],
  );
  if (agentEnabled) {
    feedArgs.push('--ignore-summary-watch');
    agentArgs.push('--snapshot', outputPath);
  }
  ```

- `scripts/build-diff-data.mjs:787-924` always reads the target's note file and
  applies complete, fresh notes. Therefore `npx diffsplain --no-agent` can show
  notes from an earlier run:

  ```js
  // scripts/build-diff-data.mjs:787-790
  const target = resolveTarget();
  const remoteRepository = githubRepository(target.remote?.url);
  const summaryDoc = readJson(summariesPath, {}) || {};
  ```

- `scripts/coding-agents.mjs:160-250` passes reasoning only to Codex
  (`model_reasoning_effort`) and OpenCode (`--variant`). Claude, Copilot, and
  Cursor ignore the value.
- `scripts/generate-summaries.mjs:764-781` reuses file notes when the patch
  fingerprint matches. It refreshes the change note when the review fingerprint
  changes. Neither test includes the selected agent, model, or reasoning level:

  ```js
  // scripts/generate-summaries.mjs:764-781
  if (
    !force &&
    previousFingerprints[path] === fileFingerprints[path] &&
    completeFileNote(previousFiles[path])
  ) {
    reusableFiles[path] = previousFiles[path];
  } else {
    changedPaths.push(path);
  }
  const changeNeedsRefresh =
    force ||
    previousSummaries.meta?.reviewFingerprint !==
      rawSnapshot.notes.reviewFingerprint ||
    !completeChangeNote(previousSummaries.change);
  ```

- `docs/content/agent-notes.mdx:20-29` shows Claude with `--reasoning low` and
  says the default batch size is four. The code uses 12
  (`scripts/cli-args.mjs:59` and `scripts/generate-summaries.mjs:118`).
- `README.md:14-18` and `docs/content/index.mdx:14-15` say a signed-in agent is
  always required even though `--no-agent` starts without one.
- The product brief says the no-argument command should work and that the app
  should preserve the repo (`PRODUCT.md:23-35`). Keep those terms: “checkout,”
  “agent notes,” and “plain diff.”
- Tests use Node's built-in test runner and fake executables in temporary
  directories. Follow `tests/generate-summaries.test.mjs:154-236` for an
  end-to-end note run and `tests/present-instances.test.mjs:86-148` for a live
  presenter run.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install | `npm ci` | exit 0 |
| Focused parser and agent tests | `node --test tests/cli-args.test.mjs tests/coding-agents.test.mjs` | all tests pass |
| Focused note tests | `node --test tests/generate-summaries.test.mjs tests/present-instances.test.mjs` | all tests pass |
| Docs | `npm run docs:check` | exit 0, no broken docs |
| Lint | `npm run lint` | exit 0, no errors |
| Full tests | `npm test` | exit 0, all tests pass |

## Scope

**In scope** (the only files you should modify):

- `scripts/cli-args.mjs`
- `scripts/coding-agents.mjs`
- `scripts/present.mjs`
- `scripts/build-diff-data.mjs`
- `scripts/generate-summaries.mjs`
- `README.md`
- `docs/content/index.mdx`
- `docs/content/cli.mdx`
- `docs/content/agent-notes.mdx`
- `tests/cli-args.test.mjs`
- `tests/coding-agents.test.mjs`
- `tests/generate-summaries.test.mjs`
- `tests/present-instances.test.mjs`
- `plans/README.md` (status row only)

**Out of scope** (do not touch):

- `app/` and the two-pane page design. “Plain diff” means no generated,
  supplied, or cached agent text. The existing generic fallback may remain.
- Provider login probes or fallback after an agent process fails. Plan 003
  covers setup reporting and troubleshooting.
- Default note and cache locations. Plan 002 changes and documents them.
- A broad CLI metadata refactor. Plan 007 centralizes the final option set.
- Generated `dist/`, `docs/dist/`, and `docs/.blume/` files.

## Git workflow

- Branch: `codex/001-agent-cache-contract`
- Use one commit for behavior and tests, then one for docs if that keeps review
  clear.
- Match the repo's short imperative commit style, such as
  `Add package scripts for CLI and doctor commands`.
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Add regression tests for each false promise

Write failing tests before changing behavior:

1. In `tests/present-instances.test.mjs`, seed a complete note file for a
   worktree, start the presenter with `--no-agent`, fetch `/diff-data.json`, and
   assert that the seeded title and body do not appear. Assert
   `notes.complete === false`, `completedFiles === 0`, and `status === "idle"`.
   Reuse the existing temporary repo, browser stub, URL waiter, and shutdown
   helpers.
2. In `tests/cli-args.test.mjs`, assert that `--no-agent --summaries notes.json`
   fails with a clear conflict error. A user must not ask for both a plain diff
   and a note source.
3. In `tests/coding-agents.test.mjs`, add a table test that marks Codex and
   OpenCode as reasoning-capable and the other three agents as not capable.
4. In `tests/generate-summaries.test.mjs`, use the recording fake agent to
   prove that an unchanged diff reuses notes only when agent, model, and
   reasoning settings also match. Cover:
   - the same settings: zero new calls;
   - a changed model: all file notes and the change note run again;
   - a changed reasoning level: all notes run again;
   - a changed agent: all notes run again.

Keep each test independent and clean up all temporary paths.

**Verify**:
`node --test tests/cli-args.test.mjs tests/coding-agents.test.mjs tests/generate-summaries.test.mjs tests/present-instances.test.mjs`
must fail only on the new assertions.

### Step 2: Make `--no-agent` ignore every note source

Use one internal data-writer flag, named `--no-summaries`, for this boundary:

1. Have `scripts/present.mjs` append `--no-summaries` to `feedArgs` whenever
   `agentEnabled` is false.
2. In `scripts/build-diff-data.mjs`, parse `--no-summaries`. When set:
   - do not read `summariesPath`;
   - do not include the note-file mtime in the watch fingerprint;
   - build all file and change text from the existing plain fallbacks;
   - report `notes.status` as `idle`, `complete` as false, and
     `completedFiles` as zero.
3. Keep `--no-summaries` internal to the data writer. Do not add it to public
   `diffsplain --help`.
4. In `scripts/cli-args.mjs`, reject an explicit `--summaries` together with
   `--no-agent`. Use the same `fail(...)` style as the target conflicts at
   lines 206-215.

Do not delete an old note file. A later normal run may reuse it.

**Verify**:
`node --test tests/cli-args.test.mjs tests/present-instances.test.mjs`
must pass, including the new cached-note case.

### Step 3: Define and enforce agent capabilities

In `scripts/coding-agents.mjs`, export one small capability record keyed by the
five existing agent names. It must state at least:

- default binary name;
- whether `--model` is supported (all five at this commit);
- whether `--reasoning` is supported (Codex and OpenCode only).

Keep `codingAgents` derived from or checked against this record so the two lists
cannot drift. Keep `cursor-agent` as Cursor's default binary.

Enforce the reasoning rule in both entry paths:

1. `scripts/cli-args.mjs` should reject `--agent claude|copilot|cursor` with
   `--reasoning` at parse time.
2. Expose the parsed reasoning value so `scripts/present.mjs` can validate it
   after automatic agent selection. If automatic selection picks an unsupported
   agent, stop before starting the page and tell the user to omit
   `--reasoning` or select Codex/OpenCode.
3. `scripts/generate-summaries.mjs` must run the same check after its own agent
   selection, since developers can call this source script directly.

Do not guess new provider flags. Keep each existing command shape unchanged.

**Verify**:
`node --test tests/cli-args.test.mjs tests/coding-agents.test.mjs tests/generate-summaries.test.mjs`
must pass and include all five agents in the capability table test.

### Step 4: Bind cached notes to their generation settings

In `scripts/generate-summaries.mjs`, define the current generation settings as:

```js
{
  agent: selectedAgent,
  model: model || null,
  reasoning: reasoning || null,
}
```

Add a helper that compares this exact shape with the prior note metadata.
Store `meta.agent` on every note file and continue storing `meta.model` and
`meta.reasoning` when set. Treat old note files with no `meta.agent` as a
settings mismatch; they should regenerate once.

Before reusing any file or change note, require both:

- the existing patch/review fingerprint match; and
- agent, model, and reasoning settings match.

When settings differ, regenerate all current file notes and the change note.
`--force` must keep its current stronger behavior. Do not put the binary path in
the cache key: users can still use `--force` after changing a binary in place.

Copy `meta.agent` into `snapshot.notes.agent` in
`scripts/build-diff-data.mjs`, beside the existing model and reasoning fields,
so the snapshot states note provenance. Preserve reading old note files that
have no metadata; they remain valid input for the data builder, but the note
generator refreshes them before reuse.

**Verify**:
`node --test tests/generate-summaries.test.mjs`
must pass, and the new settings cases must show the expected fake-agent call
counts.

### Step 5: Correct the public wording

Update only the short user-facing claims in the scoped docs:

- State that Node.js and Git are always required.
- State that a signed-in supported agent is required only for agent notes;
  `--no-agent` works without one.
- Define `--no-agent` as a run that neither calls an agent nor reads cached or
  supplied agent text.
- Change the default batch size from four to 12.
- Use Codex or OpenCode in the reasoning example. State that only those two
  agents accept `--reasoning`.
- State that Diffsplain picks the first installed agent in fallback order. It
  does not test login first and does not switch providers after a selected
  agent fails.
- Explain that cache reuse needs a matching diff plus matching agent, model,
  and reasoning settings. `--force` still refreshes identical settings.

Keep the root README short. Leave the full explanation in
`docs/content/agent-notes.mdx`.

**Verify**:

```sh
! rg -n "default batch size is four" README.md docs/content
rg -n "12|Codex|OpenCode|--no-agent|--force" docs/content/agent-notes.mdx
npm run docs:check
```

The first command must return no matches; the next two commands must exit 0.

### Step 6: Run all repository checks

Run the required checks after the focused tests.

**Verify**:

```sh
npm run lint
npm test
npm run docs:check
git status --short
```

All three checks must exit 0. `git status --short` may list only the in-scope
files and the `plans/README.md` status update.

## Test plan

- Add one live presenter regression test for cached notes under `--no-agent`.
- Add one parser conflict test for `--no-agent --summaries`.
- Add one table-driven capability test for all five agents.
- Add cache integration cases for same settings, changed model, changed
  reasoning, and changed agent.
- Extend the existing note metadata assertions to cover `meta.agent` and
  `snapshot.notes.agent`.
- Use `tests/generate-summaries.test.mjs:154-236` and
  `tests/present-instances.test.mjs:86-148` as the structural patterns.
- Final verification:
  `node --test tests/cli-args.test.mjs tests/coding-agents.test.mjs tests/generate-summaries.test.mjs tests/present-instances.test.mjs`
  must pass before the full suite.

## Done criteria

- [ ] `npx`/presenter runs with `--no-agent` never expose cached or supplied
      agent text.
- [ ] `--no-agent --summaries FILE` exits 2 with a clear conflict error.
- [ ] Only Codex and OpenCode accept `--reasoning`; unsupported combinations
      fail before agent work starts.
- [ ] A changed agent, model, or reasoning level refreshes all notes without
      `--force`.
- [ ] An unchanged diff with unchanged settings makes no new agent call.
- [ ] Note metadata and snapshots name the selected agent.
- [ ] The docs say the default batch size is 12 and make agent prerequisites
      conditional.
- [ ] `npm run lint`, `npm test`, and `npm run docs:check` all exit 0.
- [ ] `git status --short` lists no file outside the in-scope list.
- [ ] The plan row in `plans/README.md` says `DONE`.

## STOP conditions

Stop and report back if:

- Any in-scope source or docs excerpt no longer matches after the drift check.
- Meeting “plain diff” requires removing or redesigning the note pane in
  `app/`; that is a product design change outside this plan.
- A provider now has tested reasoning support, but the checked-in
  `agentCommand` does not contain the needed flag. Report the provider and
  evidence instead of guessing its command.
- Correct cache invalidation requires dropping support for note files without
  `meta`; those files remain supported input.
- A focused or full check fails twice after a reasonable fix attempt.
- The work requires a file outside the in-scope list.

## Maintenance notes

- When adding an agent, update its capability row, binary lookup, command
  builder, tests, help, and docs in one change.
- When adding a setting that changes generated text, include it in the cache
  settings comparison before release.
- Reviewers should inspect the `--no-agent` live test closely. A process-level
  “agent was not started” check alone does not prove that cached text stayed
  hidden.
- Plan 007 will centralize option metadata. Preserve the behavior and tests from
  this plan during that refactor.
