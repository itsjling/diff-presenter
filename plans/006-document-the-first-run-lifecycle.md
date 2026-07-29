# Plan 006: Document the full first-run lifecycle

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1234de6..HEAD -- README.md site/index.html docs/content/index.mdx docs/content/troubleshooting.mdx tests/docs-content.test.mjs tests/present-instances.test.mjs tests/serve-built.test.mjs plans/README.md`
> Plans 003 and 005 are expected to create or change several files in this
> list. Compare their final content with the required lifecycle below. Ignore
> status-only edits to `plans/README.md`. Stop on any other unexplained drift.
> Also run `git status --short` and record all pre-existing worktree changes.
> Preserve them throughout this plan.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**:
  `plans/003-make-doctor-honest-and-add-troubleshooting.md`,
  `plans/004-define-every-review-target.md`,
  `plans/005-fix-doc-routes-and-source-boundaries.md`
- **Category**: docs
- **Planned at**: commit `1234de6`, 2026-07-29

## Why this matters

The quick start shows one command but not the events around it. A first-time
user may see an npm install prompt, wait while the process stays open, miss the
printed URL when the browser fails, or stop the command without knowing which
files remain. This plan explains the whole run in order while keeping the
README and landing page short.

## Current state

- The Introduction says users need Node and a signed-in agent, then shows
  `npx diffsplain` (`docs/content/index.mdx:12-22`). Plan 001 makes the agent
  requirement conditional.
- npm documents that `npx` can fetch a missing package into npm's cache and may
  ask before installing it. A package spec can include an exact version.
- `scripts/present.mjs:34-43` handles help/version before checking agents, so
  `npx diffsplain --version` works without an agent.
- The server prints one stable readiness line:

  ```js
  // scripts/serve-built.mjs:147-153
  server.listen(selectedPort, '127.0.0.1', () => {
    const address = server.address();
    const readyPort =
      address && typeof address === 'object' ? address.port : selectedPort;
    console.log(`Diffsplain: http://127.0.0.1:${readyPort}`);
  });
  ```

- The presenter opens the URL after it sees that line
  (`scripts/present.mjs:163-172`). If browser launch fails, it logs
  `Could not open the browser: ...` but leaves the server running
  (`scripts/present.mjs:153-160`).
- The command starts both a watcher and a local server and stays open. `SIGINT`
  and `SIGTERM` stop its children (`scripts/present.mjs:299-328`).
- If notes are on, the page can open before note generation finishes. An agent
  failure leaves the diff page open (`scripts/present.mjs:227-261`).
- The default port starts at 2299 and increments when occupied. An explicit port
  does not increment (`scripts/serve-built.mjs:145-169`).
- Plan 002 defines the exact temp and persistent cache behavior. Link to that
  page instead of duplicating its full list.
- `tests/present-instances.test.mjs:38-60` already treats the printed URL as the
  ready signal, and lines 78-83 stop the process with `SIGTERM`.
- Keep the root README within the command-use/local-development rule in
  `AGENTS.md:5`.
- Commit `1234de6` includes a landing-page headline/metadata rewrite. Preserve
  that copy and add only the small requirement line in this plan.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install | `npm ci` | exit 0 |
| Content tests | `node --test tests/docs-content.test.mjs` | all tests pass |
| Lifecycle tests | `node --test tests/present-instances.test.mjs tests/serve-built.test.mjs` | all tests pass |
| Docs | `npm run docs:check` | exit 0 |
| Static audit | `npm run fallow:audit` | exit 0, no new findings |
| Lint | `npm run lint` | exit 0 |
| Full tests | `npm test` | exit 0, all tests pass |

## Suggested executor toolkit

- Use the official
  [npm exec/npx documentation](https://docs.npmjs.com/cli/v11/commands/npm-exec/)
  for install prompts, package specs, and npm-cache behavior.
- Follow the shape of Cloudflare's
  [Wrangler install/update guide](https://developers.cloudflare.com/workers/wrangler/install-and-update/):
  list requirements, show version check, then show the first command. Do not
  copy Wrangler's platform or install requirements.

## Scope

**In scope** (the only files you should modify):

- `README.md`
- `site/index.html`
- `docs/content/index.mdx`
- `docs/content/troubleshooting.mdx`
- `tests/docs-content.test.mjs`
- `tests/present-instances.test.mjs` (only if the ready-line contract lacks a
  direct assertion after Plan 005)
- `tests/serve-built.test.mjs` (only if the ready-line contract lacks a direct
  assertion)
- `plans/README.md` (status row only)

**Read for verification, but do not modify**:

- `package.json`
- `scripts/present.mjs`
- `scripts/serve-built.mjs`

**Out of scope** (do not touch):

- Changing startup, browser, port, signal, or cleanup behavior.
- Adding an installer, shell script, global-install path, or onboarding wizard.
- Copying the full target matrix or data contract into the README.
- Provider-specific login instructions.
- Generated `dist/`, `docs/dist/`, and `docs/.blume/` files.

## Git workflow

- Branch: `codex/006-first-run-docs`
- One docs-and-tests commit is enough.
- Match the repo's short imperative commit style.
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Guard the lifecycle facts in content tests

Extend `tests/docs-content.test.mjs` with focused assertions that the
Introduction contains:

- Node.js `22.13` and Git as core requirements;
- an agent as optional when `--no-agent` is used;
- `gh` only for pull requests;
- `npx diffsplain --version`;
- both `@latest` and an exact-version pin example;
- the exact ready-line prefix
  `Diffsplain: http://127.0.0.1:`;
- `Ctrl+C`;
- a manual-open instruction when the browser fails;
- a link to `/data` for files/cache and `/troubleshooting` for errors.

Assert that the README contains the ready-line prefix and `Ctrl+C`, but do not
require the full install explanation there.

If no existing server/presenter test directly asserts the exact ready prefix,
add that single assertion to the current test rather than creating a new
process fixture.

**Verify**:
`node --test tests/docs-content.test.mjs tests/present-instances.test.mjs tests/serve-built.test.mjs`
must fail only on missing docs text or a missing exact ready-line assertion.

### Step 2: Write the Introduction as a numbered first run

In `docs/content/index.mdx`, keep the product description, then give the first
run in this order:

1. **Check requirements**
   - Node.js 22.13 or newer and Git for every run;
   - one supported, signed-in agent only when agent notes are wanted;
   - `--no-agent` for a plain diff;
   - signed-in `gh` only for `--pr`.
2. **Check the package version**

   ```sh
   npx diffsplain --version
   ```

   State that npm may ask to install a missing package and stores it in npm's
   cache. Explain:
   - `npx diffsplain@latest --version` selects the latest published package;
   - `npx diffsplain@0.4.0 --version` pins the version current at this plan's
     commit. Plan 007 will add a test that keeps this example in sync with
     `package.json`.
3. **Start a low-dependency first review**

   ```sh
   npx diffsplain --no-agent
   ```

   Then show the normal notes-on form and one PR form.
4. **Wait for the ready line**

   ```text
   Diffsplain: http://127.0.0.1:<port>
   ```

   State that the browser should open, the printed URL always works manually,
   and the process stays in the terminal while the page and watcher run.
5. **Review and stop**
   - Notes may appear after the page opens.
   - Use the existing file navigation keys.
   - Press `Ctrl+C` in the starting terminal to stop the server and watcher.
   - Link to `/data` for temp/persistent files and `/troubleshooting` for
     failures.

Use direct prose and no platform-specific key beyond the existing
Cmd/Ctrl search shortcut.

**Verify**:

```sh
rg -n "22\\.13|--no-agent|--version|@latest|@0\\.4\\.0|Diffsplain: http://127\\.0\\.0\\.1:<port>|Ctrl\\+C|/data|/troubleshooting" docs/content/index.mdx
npm run docs:check
```

Both commands must exit 0.

### Step 3: Add the short lifecycle to entry pages

In `README.md`, add no more than one short paragraph after the first command:

- npm may ask to install the package on first use;
- wait for the printed local URL;
- the command stays open;
- press `Ctrl+C` to stop.

Keep conditional prerequisites near the current requirement line. Link to the
published Introduction for the full first run.

In `site/index.html`, add one compact requirement line in the existing Run
section:

- Node.js 22.13+ and Git;
- agent optional with `--no-agent`;
- `gh` needed for PRs.

Keep the existing command and published guide link. Do not add another command
panel or change the page layout.

**Verify**:

```sh
rg -n "install|Diffsplain: http://127\\.0\\.0\\.1:<port>|Ctrl\\+C" README.md
rg -n "22\\.13|--no-agent|gh" site/index.html
node --test tests/docs-content.test.mjs
```

All commands must exit 0.

### Step 4: Add first-run fallbacks to troubleshooting

In `docs/content/troubleshooting.mdx`, make sure the existing sections from Plan
003 cover:

- npm package install was declined or failed;
- the ready line appears but no browser opens: copy the URL;
- the process appears not to finish: it is the running server/watcher, so use
  `Ctrl+C`;
- notes take longer than the page: review ready files or use `--no-agent`;
- an explicit port is busy: omit `--port` for automatic increment or choose
  another value.

Link back to the Introduction. Do not repeat the target or storage tables.

**Verify**:

```sh
rg -n "npm|browser|copy.*URL|Ctrl\\+C|--no-agent|--port|Introduction" docs/content/troubleshooting.mdx
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

- Extend the content test with the required first-run tokens and links.
- Keep the exact server ready-line covered in an existing process test.
- Do not test npm's network or prompt in this repo; cite npm's official contract
  instead.
- Do not add browser automation for prose-only changes.
- Final focused verification:
  `node --test tests/docs-content.test.mjs tests/present-instances.test.mjs tests/serve-built.test.mjs`
  must pass.

## Done criteria

- [ ] The Introduction covers requirements, npm's first-use behavior, version
      check/pinning, start, ready URL, browser fallback, long-running process,
      notes timing, and `Ctrl+C`.
- [ ] Core, agent, and PR requirements are conditional and exact.
- [ ] README gives a short start/stop lifecycle and links to full docs.
- [ ] The landing Run section gives one compact prerequisite line.
- [ ] Troubleshooting covers first-run install, browser, waiting, notes, and
      port cases.
- [ ] Tests guard the docs tokens and exact ready-line prefix.
- [ ] `npm run lint`, `npm test`, `npm run docs:check`, and
      `npm run fallow:audit` all exit 0.
- [ ] Compared with the recorded starting status, this plan adds no change
      outside the in-scope list.
- [ ] The plan row in `plans/README.md` says `DONE`.

## STOP conditions

Stop and report back if:

- The published package version is no longer `0.4.0`; use the live
  `package.json` version, then record the drift.
- A real packed-package run prints a different ready line or exits instead of
  staying open.
- npm's current official docs no longer support the install-prompt or cache
  statement.
- The landing-page requirement line needs CSS or layout changes to remain
  readable.
- A focused or full check fails twice after a reasonable fix attempt.
- The work requires a file outside the in-scope list.
- Fallow reports a new issue that cannot be fixed within this plan. Do not edit
  `.fallowrc.json` or `fallow-baselines/` to hide it.

## Maintenance notes

- Plan 007 must tie the exact-version example to `package.json` so releases
  cannot leave stale onboarding text.
- Keep the full lifecycle in the Introduction. README, landing, and
  troubleshooting should link to it instead of growing copies.
- If startup output or shutdown behavior changes, update its process test and
  first-run prose in the same pull request.
