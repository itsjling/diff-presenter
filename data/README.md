# Diff data

`scripts/build-diff-data.mjs` writes `public/diff-data.json` for the page. It
takes Git refs or, by default, tracked and untracked worktree changes against
`HEAD`.

The file has a version and time, repo data, one change summary, and a file list.
Each file has its status, line counts, full unified patch, short unified snippet,
and a summary with what changed, why, details, and risks. The page treats binary
files as metadata. The writer gives each new set a content hash and swaps in a
new file only when the data changed.

Without `--summaries`, the script reads
`.beautiful-diffs/summaries.json` from the chosen repo. It leaves that note file
and its own output out of the diff.

Example:

```sh
node scripts/build-diff-data.mjs --repo /path/to/repo --base BASE --head HEAD \
  --summaries data/pr-198-summaries.json --output public/diff-data.json
```

Add `--watch` to check Git state and the note file every two seconds. The
`npm run present -- --repo /path/to/repo` command starts both the watcher and the
local page.

Remote targets do not depend on the current checkout:

```sh
node scripts/build-diff-data.mjs --repo /path/to/repo --pr 42
node scripts/build-diff-data.mjs --repo /path/to/repo --branch topic \
  --base main --remote origin
```

The script fetches those refs into `.cache/git`, computes the merge base, and
reads the diff from that bare cache. The chosen repo’s checkout, index, refs,
and `FETCH_HEAD` stay unchanged. In watch mode, the script checks the remote
again every 30 seconds.

`repo.base` and `repo.head` hold the exact commits used for the diff.
`repo.target` records the target kind, remote refs, remote tips, and merge base.
