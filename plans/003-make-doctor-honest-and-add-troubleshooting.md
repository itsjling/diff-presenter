# Plan 003: Make doctor honest and add troubleshooting

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1234de6..HEAD -- scripts/doctor.mjs scripts/present.mjs README.md docs/content/index.mdx docs/content/cli.mdx docs/content/troubleshooting.mdx docs/blume.config.ts tests/doctor.test.mjs plans/README.md`
> Plan 001 is expected to change some docs and presenter code. Compare its final
> behavior with this plan. Ignore status-only edits to `plans/README.md`. Stop
> on any other unexplained mismatch.
> Also run `git status --short` and record all pre-existing worktree changes.
> Preserve them throughout this plan.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-make-agent-and-cache-behavior-truthful.md`
- **Category**: dx
- **Planned at**: commit `1234de6`, 2026-07-29

## Why this matters

`diffsplain doctor` calls `--version` and then says installed tools are ready.
That wording claims more than the check proves: an agent may not be signed in,
and `gh` may have no valid account. The command also exits with failure when
plain local review would work with `--no-agent`. This plan reports core,
agent-note, and pull-request capabilities separately and gives users fixes for
the errors the CLI emits.

## Current state

- `scripts/doctor.mjs:24-31` runs only `<command> --version`:

  ```js
  function commandVersion(command) {
    const result = spawnSync(command, ['--version'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return undefined;
    return firstLine(`${result.stdout || ''}\n${result.stderr || ''}`);
  }
  ```

- It prints these claims for any installed executable:

  ```js
  // scripts/doctor.mjs:100-109
  git.installed
    ? '  ✓ Git reviews are ready.'
    : '  ✗ Git is not installed.',
  installedAgents.length
    ? `  ✓ Agent notes are ready with ${joinedAgentNames(installedAgents)}.`
    : '  ✗ No supported coding agent is installed.',
  gh.installed
    ? '  ✓ Pull request lookup is ready with gh.'
    : '  ✗ gh is not installed; pull request lookup is unavailable.',
  ```

- `doctorReport` returns
  `ready: git.installed && installedAgents.length > 0`
  (`scripts/doctor.mjs:115-118`). `scripts/present.mjs:45-49` uses that value as
  the process exit status. A machine with Git and no agent therefore gets exit
  1 even though `diffsplain --no-agent` can run.
- The report does not check the package's Node floor (`package.json:39-40`),
  which is `>=22.13.0`.
- `tests/doctor.test.mjs:27-56` expects “Agent notes are ready” from a fake
  installed Cursor. Lines 58-80 expect exit 1 when `PATH` is empty, but that
  case also lacks Git, so it does not isolate the optional-agent rule.
- `docs/content/cli.mdx:81-92` says the report shows paths, versions, and
  readiness. The root README uses the same wording.
- Runtime errors already give stable troubleshooting keys:
  - no installed agent: `scripts/coding-agents.mjs:81-86`;
  - selected agent missing: `scripts/coding-agents.mjs:69-77`;
  - agent process failure: `scripts/generate-summaries.mjs:633-649`;
  - pull request/auth failure: `scripts/build-diff-data.mjs:483-487`;
  - default branch failure: `scripts/build-diff-data.mjs:394-419`;
  - remote fetch failure: `scripts/build-diff-data.mjs:319-336`;
  - browser open failure: `scripts/present.mjs:153-159`;
  - server/port failure: `scripts/serve-built.mjs:156-169`.
- Follow the fake executable helper in `tests/doctor.test.mjs:16-25`. Keep the
  report plain text and dependency-free.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install | `npm ci` | exit 0 |
| Doctor tests | `node --test tests/doctor.test.mjs tests/present-help.test.mjs` | all tests pass |
| Manual report | `node scripts/present.mjs doctor` | prints a report; exit depends only on Node and Git |
| Docs | `npm run docs:check` | exit 0 |
| Static audit | `npm run fallow:audit` | exit 0, no new findings |
| Lint | `npm run lint` | exit 0 |
| Full tests | `npm test` | exit 0, all tests pass |

## Suggested executor toolkit

- Use the official
  [`gh auth status` manual](https://cli.github.com/manual/gh_auth_status) for
  its tested exit behavior. Do not use `--json` for this check; the manual says
  JSON mode can exit 0 despite auth issues.
- Use the GitHub CLI
  [exit-code guide](https://cli.github.com/manual/gh_help_exit-codes) as the
  model for a short, explicit exit-code section.

## Scope

**In scope** (the only files you should modify):

- `scripts/doctor.mjs`
- `scripts/present.mjs` (only the doctor result/exit handling if needed)
- `README.md`
- `docs/content/index.mdx`
- `docs/content/cli.mdx`
- `docs/content/troubleshooting.mdx` (create)
- `docs/blume.config.ts`
- `tests/doctor.test.mjs`
- `plans/README.md` (status row only)

**Out of scope** (do not touch):

- Running test prompts against Codex, Claude, Copilot, Cursor, or OpenCode.
  Such checks can cost money, send data, or create sessions.
- Provider-specific login commands or parsing provider error text.
- Automatic fallback after a selected agent fails.
- Target behavior, cache paths, or the review page.
- Generated `dist/`, `docs/dist/`, and `docs/.blume/` files.

## Git workflow

- Branch: `codex/003-honest-doctor`
- Keep report behavior and tests together. Put the troubleshooting page in a
  second commit if useful.
- Match the repo's short imperative commit style.
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Replace readiness assumptions with capability tests

Update `tests/doctor.test.mjs` first. Build fake commands that inspect their
arguments so a fake `gh` can return one result for `--version` and another for
`auth status --active`.

Cover at least these cases:

1. Supported Node + Git, no agent, no `gh`:
   - plain local review says ready;
   - agent notes say no agent is installed and point to `--no-agent`;
   - pull-request lookup says `gh` is missing;
   - the report's process-ready value is true.
2. Supported Node + Git + one agent:
   - the report says the executable and version were found;
   - it says agent sign-in was **not checked**;
   - it never says “Agent notes are ready.”
3. Installed `gh` whose `auth status --active` exits 0:
   - pull-request lookup says the auth check passed.
4. Installed `gh` whose auth check exits nonzero:
   - the report keeps the version/path;
   - it says the auth check failed and suggests `gh auth login`;
   - core readiness remains true.
5. Missing Git:
   - core readiness is false and the command exits 1.
6. Node `v22.12.0`:
   - core readiness is false and the report states the `22.13.0` floor.
7. Node `v22.13.0` or newer:
   - the Node check passes.

Keep the integration-level `spawnSync` assertion for process exit codes, but
give it a fake Git executable so “no agent” is tested apart from “no Git.”

**Verify**:
`node --test tests/doctor.test.mjs` must fail only on the new expected report
and exit behavior.

### Step 2: Report three separate capabilities

Refactor `scripts/doctor.mjs` without adding a package:

1. Parse `process.version` enough to compare major, minor, and patch with
   `22.13.0`. Keep the required version in one named constant.
2. Keep the current dependency rows for Node, Git, `gh`, and every coding
   agent. A successful `--version` proves only that the executable ran.
3. If `gh` is installed, run:

   ```sh
   gh auth status --active
   ```

   with a five-second timeout and captured output. Record only pass/fail; never
   include tokens or full auth output in the Diffsplain report.
4. Replace the single “Status” claim with a “Capabilities” section:
   - **Plain local review**: ready only when Node meets the floor and Git is
     installed.
   - **Agent notes**: list installed agents and say sign-in was not checked.
     If none exist, point to `--no-agent`.
   - **Pull request lookup**: distinguish missing `gh`, installed but failed
     auth check, and installed with a passed auth check. Note that auth can
     still vary by host/repo.
5. Keep `doctorReport(...).ready`, but define and document it as core plain
   review readiness: supported Node plus Git. `present.mjs` may keep using it
   for exit 0/1.

Do not mark a provider ready from `--version`.

**Verify**:

```sh
node --test tests/doctor.test.mjs
node scripts/present.mjs doctor
```

The test must pass. The manual report must contain “Plain local review,” “Agent
notes,” and “Pull request lookup.”

### Step 3: Document the report and its exit code

Update the root README and `/cli` in plain terms:

- call `doctor` a dependency and capability report, not a full readiness test;
- say it checks Node and Git for plain review;
- say it finds agent executables but does not test their login;
- say it runs `gh auth status --active` when `gh` exists;
- define exit 0 as “Node and Git can run a plain local review” and exit 1 as a
  missing core requirement;
- explain that warnings for optional agent/PR features do not change that exit
  code.

Keep the README to two or three sentences around its existing command. Put the
full table in `/cli`.

**Verify**:

```sh
rg -n "sign-in.*not checked|auth status|exit 0|exit 1|plain" docs/content/cli.mdx
! rg -n "Agent notes are ready|readiness" README.md docs/content/cli.mdx
npm run docs:check
```

The first and third commands must exit 0. The negative search must find no
outdated claim.

### Step 4: Add a troubleshooting page keyed to real errors

Create `docs/content/troubleshooting.mdx` and add `/troubleshooting` to
`docs/blume.config.ts` after the user guides and before Development.

Use symptom-first headings that quote only short stable fragments of current
errors. Include:

- Node version is below 22.13.0;
- Git is missing or the path is not a Git checkout;
- no coding agent is installed;
- a chosen agent is unavailable;
- an installed agent fails or is not signed in;
- `gh` cannot read a pull request;
- the default branch cannot be found locally;
- the remote target cannot be fetched;
- the chosen port is busy;
- the browser does not open;
- notes are stale, failed, or need a forced refresh;
- a batch remains too large after patch excerpts.

For each section, give:

1. the cause the current code can support;
2. one or two safe checks;
3. the exact Diffsplain retry command.

Required commands include `diffsplain doctor`, `gh auth status`,
`gh auth login`, `git remote -v`, `git branch -a`, `--agent NAME`,
`--no-agent`, `--base`, `--port`, and `--force` where they fit.

For provider login, tell users to run the selected agent directly and follow
its current login/help flow. Do not invent five login commands.

Link to this page from `/cli` and the Introduction.

**Verify**:

```sh
rg -n "^## |diffsplain doctor|gh auth status|--no-agent|--force|--port|--base" docs/content/troubleshooting.mdx
npm run docs:check
```

Both commands must exit 0, and Blume must include the new route.

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

- Replace the broad doctor expectations with capability-specific assertions.
- Add fake `gh` success and failure cases for `auth status --active`.
- Add exact Node-floor cases.
- Separate “Git missing” from “agent missing” in process exit tests.
- Assert that no report says an agent is signed in or ready based only on
  `--version`.
- Model fake executables after `tests/doctor.test.mjs:16-25`; keep all fixture
  data local and temporary.
- Final focused verification:
  `node --test tests/doctor.test.mjs tests/present-help.test.mjs` must pass.

## Done criteria

- [ ] Doctor reports core, agent-note, and pull-request capabilities separately.
- [ ] Installed agents are never called signed in or ready without a login
      check.
- [ ] Doctor checks `gh auth status --active` without printing sensitive auth
      output.
- [ ] Doctor exits 0 when supported Node and Git allow `--no-agent`, even if no
      agent or `gh` exists.
- [ ] Doctor exits 1 when Node is below 22.13.0 or Git is missing.
- [ ] `/troubleshooting` covers every listed runtime error with safe checks and
      retry commands.
- [ ] The new page appears in Blume navigation.
- [ ] `npm run lint`, `npm test`, `npm run docs:check`, and
      `npm run fallow:audit` all exit 0.
- [ ] Compared with the recorded starting status, this plan adds no change
      outside the in-scope list.
- [ ] The plan row in `plans/README.md` says `DONE`.

## STOP conditions

Stop and report back if:

- Plan 001 changed the meaning or exit behavior of `--no-agent`.
- Current `gh auth status --active` does not have the official exit behavior
  linked above.
- An agent login check would require running a prompt, sending data, creating a
  session, or parsing unstable prose.
- A useful troubleshooting fix needs a command that the checked-in CLI does not
  support.
- A focused or full check fails twice after a reasonable fix attempt.
- The work requires a file outside the in-scope list.
- Fallow reports a new issue that cannot be fixed within this plan. Do not edit
  `.fallowrc.json` or `fallow-baselines/` to hide it.

## Maintenance notes

- Keep “installed,” “auth check passed,” and “ready” as distinct states.
- If a provider later offers a stable, non-interactive auth-status command, add
  it with fake-executable tests before changing doctor wording.
- Reviewers should verify doctor output with no optional tools. That is the case
  most likely to regress into a false failure.
- Add new stable runtime errors to `/troubleshooting` in the same change that
  introduces them.
