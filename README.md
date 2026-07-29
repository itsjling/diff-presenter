# Diff Presenter

Diff Presenter is an open-source developer tool for reviewing GitHub pull
requests. Run it on a PR to see one changed file at a time: the unified diff on
the left and a short note from a coding agent on the right.

It runs on your machine and keeps the code and its context in one review view.

## Run it

```sh
npx diff-presenter
```

With no arguments, Diff Presenter compares the current checkout with its
default branch. The diff includes local commits plus staged, unstaged, and
untracked work.

Codex writes the notes by default. The command uses the Codex CLI and its
current login. Pass the agent name when you want to state it:

```sh
npx diff-presenter --agent codex
```

Codex is the only agent supported for now. Pass `--no-agent` for a plain diff.

The page opens at [http://localhost:3000](http://localhost:3000). Use the arrow
buttons or the left and right arrow keys to move between files. Press `Cmd+K` or
`Ctrl+K` to search the file list. Long diffs have a control to switch between
the excerpt and the full patch.

### Review a pull request

Use a PR number in the current repo:

```sh
npx diff-presenter --pr 198
```

You can run the command outside a checkout when you pass a repo:

```sh
npx diff-presenter --repo owner/repo --pr 198
npx diff-presenter --repo https://github.com/owner/repo --pr 198
```

A full PR URL also carries the repo:

```sh
npx diff-presenter --pr https://github.com/owner/repo/pull/198
```

Diff Presenter uses `gh` to read PR data. Sign in with `gh auth login` when
needed. It fetches the Git objects into its own bare cache and does not change
the checkout, index, local refs, or `FETCH_HEAD`.

### Review a branch

Pass a branch from the current repo:

```sh
npx diff-presenter --branch feature/my-change
```

Or pair it with a local path, Git URL, or `owner/repo` name:

```sh
npx diff-presenter /path/to/repo --branch feature/my-change
npx diff-presenter owner/repo --branch feature/my-change
```

Diff Presenter compares the branch with the remote’s default branch. A remote
repo has no current checkout, so `--repo URL|OWNER/NAME` needs `--branch` or
`--pr`.

## Open the bundled todo demo

The bundled data set is a made-up pull request for a small todo list. Its ten
changed files add filters, due dates, saved todos, and tests.

```sh
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Other review targets

### Review worktree changes

Use `--worktree` to show only tracked and untracked changes against `HEAD`:

```sh
npx diff-presenter --worktree
```

While this command runs, it asks Codex for fresh notes when the Git diff
changes. It sends up to four files at a time and adds each finished batch to the
open page, so you can start with the first notes while Codex writes the rest.
Codex gets a read-only JSON snapshot; it does not change the target repo. The
command sends that snapshot to the Codex service tied to your CLI login.

Choose another base or remote when needed:

```sh
npx diff-presenter \
  --repo /path/to/repo \
  --branch feature/my-change \
  --base next \
  --remote upstream
```

The runner fetches these targets into its own bare cache under `.cache/git`.
It does not switch or change the chosen repo’s checkout, index, local refs, or
`FETCH_HEAD`.

### Review an exact local range

Pass two refs that already exist in the chosen repo:

```sh
npx diff-presenter \
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

Run one agent pass for a PR without starting the page:

```sh
npm run summarize -- --repo /path/to/repo --pr 198
```

The same command also supports other targets:

```sh
npm run summarize -- --repo /path/to/repo --branch feature/my-change
```

The presenter reuses complete notes when their diff fingerprint still matches.
`summarize` always asks for a new pass.

The spawned agent sees the selected diff, not the conversation from another
Codex task. It can explain the apparent reason for a change. For the exact
reason from an active coding task, have that agent update the worktree summary
file before its turn ends.

You can also pick the model, reasoning effort, batch size, or Codex executable:

```sh
npm run summarize -- \
  --repo /path/to/repo \
  --pr 198 \
  --model MODEL_NAME \
  --reasoning low \
  --batch-size 2 \
  --codex-bin /path/to/codex
```

The same `--model`, `--reasoning`, and `--batch-size` options work with
`npx diff-presenter`. The default batch size is four files. Use
`--batch-size 1` to publish one note at a time.

For a working tree, the default summary file is:

```text
/path/to/repo/.beautiful-diffs/summaries.json
```

Checkout, PR, branch, and exact-range notes go in Diff Presenter’s ignored
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
