# Diff Presenter

Review a Git diff one file at a time, with a short Codex note beside each
patch.

## Use

Run from a Git checkout:

```sh
npx diff-presenter
```

The command opens [http://localhost:3000](http://localhost:3000) and compares
the checkout with its default branch. You need Node.js 22.13 or newer and a
signed-in Codex CLI. Pull requests also need a signed-in GitHub CLI.

Common targets:

```sh
npx diff-presenter --pr 198
npx diff-presenter owner/repo --branch feature/my-change
npx diff-presenter --worktree
npx diff-presenter --base BASE_REF --head HEAD_REF
```

Arguments:

| Argument | Use |
| --- | --- |
| `REPO`, `--repo PATH\|URL\|OWNER/REPO` | Select a local or remote repo. |
| `--pr NUMBER\|URL` | Review a GitHub pull request. |
| `--branch NAME` | Compare a remote branch with its default branch. |
| `--worktree` | Review tracked and untracked changes against `HEAD`. |
| `--base REF --head REF` | Review an exact local range. |
| `--agent [codex]`, `--no-agent` | Enable Codex notes, or show a plain diff. |
| `--model NAME` | Choose the Codex model used for notes. |
| `--reasoning LEVEL` | Set `minimal`, `low`, `medium`, `high`, or `xhigh`. |
| `--batch-size COUNT` | Set files per Codex pass. The default is `4`. |
| `--remote NAME\|URL` | Choose the Git remote. The default is `origin`. |
| `--port NUMBER` | Choose the local port. The default is `3000`. |
| `--help` | Show command help. |

## Local development

```sh
npm install
npm run dev
```

Run the checks:

```sh
npm run lint
npm test
```

Run the Blume docs:

```sh
npm run docs:dev
```

More guides are in [`docs/`](docs/).
