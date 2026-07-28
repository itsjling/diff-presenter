# Diff Presenter

Diff Presenter is a local code review page. It shows one changed file at a time:
the unified diff on the left and a short note from the coding agent on the
right.

The first data set is PR #198 from `u-do-app`. It has all 57 changed files,
including binary files and short excerpts for long diffs.

## Open the PR #198 demo

```sh
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Use the arrow buttons or the left and right arrow keys to move between files.
Press `Cmd+K` or `Ctrl+K` to search the file list. Long diffs have a control to
switch between the excerpt and the full patch.

## Use another Git workspace

Start the page and its Git watcher with one command:

```sh
npm run present -- --repo /path/to/repo
```

By default, this shows tracked and untracked changes against `HEAD`.

Add `--agent` to have Codex write the notes. The page opens at once, then
refreshes when the notes arrive:

```sh
npm run present -- --repo /path/to/repo --agent
```

While this command runs, it asks Codex for fresh notes when the Git diff
changes. Codex gets a read-only JSON snapshot; it does not change the target
repo. The command sends that snapshot to the Codex service tied to your CLI
login.

### Target a pull request

Pass a GitHub pull request number or URL. Your local branch can point anywhere:

```sh
npm run present -- --repo /path/to/repo --pr 198 --agent
npm run present -- --repo /path/to/repo \
  --pr https://github.com/owner/repo/pull/198 \
  --agent
```

This path uses `gh`, so sign in first with `gh auth login` when needed.

### Target a remote branch

Pass the remote branch name. Diff Presenter compares it with the remote’s
default branch:

```sh
npm run present -- --repo /path/to/repo --branch feature/my-change
```

Choose another base or remote when needed:

```sh
npm run present -- \
  --repo /path/to/repo \
  --branch feature/my-change \
  --base next \
  --remote upstream
```

The runner fetches these targets into its own bare cache under `.cache/git`.
It does not switch or change the chosen repo’s checkout, index, local refs, or
`FETCH_HEAD`.

### Target an exact local range

Pass two refs that already exist in the chosen repo:

```sh
npm run present -- \
  --repo /path/to/repo \
  --base BASE_REF \
  --head HEAD_REF \
  --summaries /path/to/summaries.json
```

The watcher updates `public/diff-data.json` when Git state or the summary file
changes. It checks remote PRs and branches every 30 seconds. The open page checks
the data file every 1.5 seconds and keeps the current file selected when a new
snapshot arrives.

## Generate or revise the agent notes

Run one agent pass without starting the page:

```sh
npm run summarize -- --repo /path/to/repo --pr 198
npm run summarize -- --repo /path/to/repo --branch feature/my-change
```

`present --agent` reuses complete notes when their diff fingerprint still
matches. `summarize` always asks for a new pass.

The spawned agent sees the selected diff, not the conversation from another
Codex task. It can explain the apparent reason for a change. For the exact
reason from an active coding task, have that agent update the worktree summary
file before its turn ends.

You can also pick a model or Codex executable:

```sh
npm run summarize -- \
  --repo /path/to/repo \
  --pr 198 \
  --model MODEL_NAME \
  --codex-bin /path/to/codex
```

For a working tree, the default summary file is:

```text
/path/to/repo/.beautiful-diffs/summaries.json
```

PR, branch, and exact-range notes go in Diff Presenter’s ignored
`.cache/summaries` folder instead. This keeps the target checkout clean and
keeps notes from two targets apart. Pass `--summaries FILE` when you want
another path.

The agent command writes the chosen file. A coding agent already working on a
worktree can update `.beautiful-diffs/summaries.json` at the end of a turn. The
file uses this shape:

```json
{
  "change": {
    "title": "Short change title",
    "summary": "What the whole change does.",
    "why": "Why the change is needed.",
    "highlights": ["One key result."],
    "risks": ["One point to check."]
  },
  "files": {
    "src/example.ts": {
      "title": "Short file title",
      "what": "What changed in this file.",
      "why": "Why this file had to change.",
      "details": ["One useful detail."],
      "risks": []
    }
  }
}
```

Missing notes get a plain fallback, so a new file still appears at once. The
full data contract and a build example are in
[`data/README.md`](data/README.md).

## Build and checks

```sh
npm run snapshot -- --repo /path/to/repo
npm run build
npm test
```

The data script runs Git with argument arrays. Local diff modes only read the
chosen workspace. Remote modes write fetched objects to Diff Presenter’s bare
cache. The browser never runs Git or reads files outside the generated JSON
snapshot.
