# Plan 007: Build one complete CLI reference with drift checks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 1234de6..HEAD -- scripts/cli-args.mjs scripts/cli-options.mjs scripts/check-cli-docs.mjs scripts/coding-agents.mjs package.json README.md docs/content/index.mdx docs/content/cli.mdx docs/content/development.mdx tests/cli-args.test.mjs tests/present-help.test.mjs tests/docs-contract.test.mjs tests/docs-content.test.mjs plans/README.md`
> Plans 001-006 must land first and will change many listed files. Compare their
> final behavior with this plan, then update the current-state assumptions
> before coding. Ignore status-only edits to `plans/README.md`. Stop on any
> unexplained mismatch.
> Also run `git status --short` and record all pre-existing worktree changes.
> Preserve them throughout this plan.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**:
  `plans/001-make-agent-and-cache-behavior-truthful.md`,
  `plans/002-state-data-and-storage-boundaries.md`,
  `plans/003-make-doctor-honest-and-add-troubleshooting.md`,
  `plans/004-define-every-review-target.md`,
  `plans/005-fix-doc-routes-and-source-boundaries.md`,
  `plans/006-document-the-first-run-lifecycle.md`
- **Category**: dx
- **Planned at**: commit `1234de6`, 2026-07-29

## Why this matters

The public parser accepts four path controls that `diffsplain --help` and the
option table omit. Defaults and provider support also live in several files, so
the docs can drift without a test failure. This plan makes `/cli` the complete
public reference, derives parser/help facts from one option record, and makes
`npm run docs:check` fail when the reference, environment table, or pinned
version goes stale.

## Current state

- `scripts/cli-args.mjs:5-35` has three hand-maintained sets. It accepts:

  ```js
  // scripts/cli-args.mjs:5-20
  const valueOptions = new Set([
    '--repo',
    '--branch',
    '--pr',
    '--base',
    '--head',
    '--remote',
    '--summaries',
    '--output',
    '--cache-dir',
    '--codex-bin',
    '--model',
    '--reasoning',
    '--batch-size',
    '--jobs',
    '--port',
  ]);
  ```

- The help string at `scripts/cli-args.mjs:37-75` omits `--summaries`,
  `--output`, `--cache-dir`, and `--codex-bin`.
- The `/cli` options table at `docs/content/cli.mdx:109-129` omits the same four
  accepted options, though the Introduction says “every target and option”
  (`docs/content/index.mdx:42`).
- `--agent` has a special parser that permits no value
  (`scripts/cli-args.mjs:144-157`). That no-value form has no documented
  meaning; it behaves like the default automatic selection.
- Public path values resolve from the directory where the user invoked
  Diffsplain (`scripts/cli-args.mjs:256-281`).
- Current numeric contracts:
  - batch size: default 12, range 1-50;
  - jobs: default 3, range 1-8;
  - port: default start 2299, range 0-65535.
- Current environment controls:
  - `BROWSER` in `scripts/present.mjs:136-160`;
  - `CODEX_BIN`, `CLAUDE_BIN`, `COPILOT_BIN`, `CURSOR_BIN`, and
    `OPENCODE_BIN` in `scripts/coding-agents.mjs:89-99`;
  - Cursor defaults to `cursor-agent`; the other default executable names match
    their agent names.
- `--codex-bin` takes precedence over `CODEX_BIN`
  (`scripts/coding-agents.mjs:96`). Other agents have only their environment
  override.
- `scripts/present.mjs:25-49` uses exit 2 for parse errors, 0 for
  help/version, and doctor status from Plan 003. Startup failures use exit 1.
  An agent failure after the page starts leaves the page running
  (`scripts/present.mjs:250-255`).
- `tests/present-help.test.mjs:8-18` checks only the usage prefix, doctor, and
  version flag. It cannot catch a missing option.
- `package.json:46` runs only Blume checks:

  ```json
  "docs:check": "cd docs && blume check && blume validate"
  ```

- Commit `7aceb55` changed `package.json.files` from the whole `scripts`
  directory to an explicit script list. Any new runtime-imported script must be
  added to that list or the packed CLI will fail after install.
- Commit `1234de6` adds Fallow setup. Preserve it. This plan may edit package
  scripts and the published-file list, but it must not add, remove, or update
  that dependency.
- Plan 001 should leave a single agent capability record in
  `scripts/coding-agents.mjs`. Reuse it for provider rows; do not create another
  provider list.
- Keep the root README short under `AGENTS.md:5`. `/cli` holds the full
  reference.
- Match the no-dependency table-driven style in `scripts/cli-args.mjs` and
  `tests/cli-args.test.mjs`.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install | `npm ci` | exit 0 |
| Parser/help tests | `node --test tests/cli-args.test.mjs tests/present-help.test.mjs` | all tests pass |
| Docs contract | `npm run docs:contract` | exit 0; reference blocks match metadata |
| Docs | `npm run docs:check` | contract and Blume checks exit 0 |
| Static audit | `npm run fallow:audit` | exit 0, no new findings |
| Lint | `npm run lint` | exit 0 |
| Full tests | `npm test` | exit 0, all tests pass |

## Suggested executor toolkit

- Follow Terraform's
  [CLI overview](https://developer.hashicorp.com/terraform/cli/commands) for
  grouping primary workflow commands before less common controls.
- Follow Vercel's
  [global options reference](https://vercel.com/docs/cli/global-options) for a
  consistent option/default/example shape.
- Follow GitHub CLI's separate
  [environment](https://cli.github.com/manual/gh_help_environment) and
  [exit-code](https://cli.github.com/manual/gh_help_exit-codes) pages for
  explicit non-flag contracts.
- Follow Docker's
  [CLI reference](https://docs.docker.com/reference/cli/docker/) for one table
  that states environment precedence and defaults.
- Use those structures only. Diffsplain should not add flags merely because
  another CLI has them.

## Scope

**In scope** (the only files you should modify):

- `scripts/cli-options.mjs` (create)
- `scripts/check-cli-docs.mjs` (create)
- `scripts/cli-args.mjs`
- `scripts/coding-agents.mjs` (only capability/environment metadata needed by
  the reference)
- `package.json`
- `README.md`
- `docs/content/index.mdx`
- `docs/content/cli.mdx`
- `docs/content/development.mdx`
- `tests/cli-args.test.mjs`
- `tests/present-help.test.mjs`
- `tests/docs-contract.test.mjs` (create)
- `tests/docs-content.test.mjs`
- `plans/README.md` (status row only)

**Out of scope** (do not touch):

- Changing target semantics, note caching, storage defaults, doctor behavior, or
  startup flow set by Plans 001-006.
- Adding completion, config files, color flags, JSON output, or new commands.
- Removing an already accepted option. This plan documents all four advanced
  path options for compatibility.
- Generating the whole prose page. Only exact reference tables should come from
  metadata.
- Internal `build-diff-data.mjs` and `generate-summaries.mjs` flags that the
  public presenter does not accept, such as `--checkout`, `--watch`,
  `--snapshot`, and `--range`.
- Generated `dist/`, `docs/dist/`, and `docs/.blume/` files.

## Git workflow

- Branch: `codex/007-cli-reference-contract`
- Use one commit for option metadata/parser/help and tests, then one for docs
  contract and content if useful.
- Match the repo's short imperative commit style.
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Characterize the full accepted option set

Before refactoring, extend tests:

1. In `tests/cli-args.test.mjs`, add a table for every accepted long option.
   Give value options a valid value and flags no value. Assert parsing does not
   raise an unknown-option error.
2. Add exact forwarding/path assertions for:
   - `--summaries`: both feed and agent paths;
   - `--output`: both feed and agent paths;
   - `--cache-dir`: both feed and agent paths;
   - `--codex-bin`: agent path plus `codexBin`.
   Relative paths must resolve from `callerDirectory`.
3. Assert `--agent` without a value exits with `--agent needs a value`.
4. Assert passing any single-value option twice fails, including `--agent`.
5. In `tests/present-help.test.mjs`, list every accepted public long option and
   assert help contains it exactly once in an option/target line.

The four advanced path options are public from this plan forward. Do not hide
them in tests.

**Verify**:
`node --test tests/cli-args.test.mjs tests/present-help.test.mjs` must fail only
on incomplete help, no-value `--agent`, or duplicate handling.

### Step 2: Create one option and environment record

Create `scripts/cli-options.mjs`. Export immutable definitions for:

- command forms (`diffsplain [REPO] [options]`, `diffsplain doctor`);
- public target options;
- normal options;
- advanced path options;
- help/version aliases;
- Diffsplain-specific environment variables.

Each option definition must carry enough data to render and test:

```js
{
  name: '--batch-size',
  aliases: [],
  kind: 'value',
  valueLabel: 'COUNT',
  section: 'notes',
  defaultValue: '12',
  minimum: 1,
  maximum: 50,
  path: false,
  summary: 'Maximum files per agent pass',
  docs: 'Set the most files per agent pass. Large patches can make a smaller batch.',
}
```

Use fields only when they apply. Include `public: true` on every presenter
option. If you need internal parser metadata, name it clearly and exclude it
from public renderers.

Required advanced definitions:

- `--summaries FILE`: note input/cache path; conflicts with `--no-agent`;
- `--output FILE`: persistent live snapshot path instead of a temp snapshot;
- `--cache-dir PATH`: bare Git cache root for remote targets;
- `--codex-bin FILE`: Codex executable path override.

Required environment definitions:

- `BROWSER`;
- `CODEX_BIN`;
- `CLAUDE_BIN`;
- `COPILOT_BIN`;
- `CURSOR_BIN`;
- `OPENCODE_BIN`.

State defaults and precedence in the definitions. Reuse the agent capability
record from Plan 001 for agent names, default binaries, model support, and
reasoning support.

Export render helpers for:

- the CLI help option/target sections;
- a Markdown public-option table;
- a Markdown environment table;
- a Markdown agent-support table.

Keep rendering deterministic and dependency-free.

Add `scripts/cli-options.mjs` to `package.json.files` because the installed
public parser imports it. Keep `scripts/check-cli-docs.mjs` development-only
and out of the published file list; `docs:contract` runs from a source checkout,
not from an installed dependency.

**Verify**:

```sh
node -e "import('./scripts/cli-options.mjs').then((m) => console.log(m.cliOptionDefinitions.length))"
npm pack --dry-run --json
```

The first command must print a positive integer. The pack listing must contain
`scripts/cli-options.mjs`.

### Step 3: Derive parsing and help from the record

Refactor `scripts/cli-args.mjs`:

- derive value, flag, alias, and path sets from `cliOptionDefinitions`;
- generate the target/options part of `helpText` with the renderer;
- keep examples and the fallback-order note around the generated sections;
- route `--agent` through normal required-value and duplicate checks, then
  validate its choice;
- keep `-h`/`-v` aliases;
- keep `--name=value` support;
- keep every target conflict and forwarding rule from prior plans.

Do not move target resolution or process startup into the metadata module.
Metadata describes the option set; parser code still applies behavior.

Help must show:

- defaults and numeric limits;
- the four advanced path options under an “Advanced paths” heading;
- that only Codex/OpenCode accept reasoning;
- that `doctor` takes no options;
- where to find the full docs URL.

**Verify**:

```sh
node --test tests/cli-args.test.mjs tests/present-help.test.mjs
node scripts/present.mjs --help
```

Tests must pass. Manual help must show every public option once and use aligned,
readable rows.

### Step 4: Make `/cli` the complete public reference

Keep the target matrix from Plan 004. After the task examples, add these
reference sections:

1. **Synopsis and command forms**
2. **Target selection and conflicts**
3. **Agent selection and cache behavior**
4. **Options**
5. **Advanced paths**
6. **Environment variables**
7. **Exit codes**
8. **Examples**

Use exact marker pairs around generated tables:

```md
<!-- cli-options:start -->
...rendered option table...
<!-- cli-options:end -->
```

Use matching `cli-environment` and `cli-agents` marker names for the other two
tables.

The prose must cover:

- `REPO` accepted forms and path/URL detection;
- path resolution from invocation directory;
- all target conflicts;
- fallback agent order and explicit selection;
- model and reasoning support by provider;
- cache reuse and `--force` after Plan 001;
- numeric defaults and limits;
- automatic versus explicit port behavior, including port 0;
- effect and persistence of each advanced path;
- option/environment precedence;
- exit 0, 1, and 2:
  - 0 for help/version, clean shutdown, and core-ready doctor;
  - 1 for startup/runtime failure or failed core doctor;
  - 2 for invalid command syntax/options;
  - a note-process failure after startup leaves the page open and does not
    immediately end the command.

Do not describe internal source-script flags. Keep examples based on
`npx diffsplain`.

Update the Introduction's “every target and option” link only if its route or
label needs correction. Keep README's option list short and link to `/cli`.

**Verify**:

```sh
rg -n "^## (Synopsis|Target|Agent|Options|Advanced|Environment|Exit|Examples)" docs/content/cli.mdx
rg -n "cli-options:start|cli-environment:start|cli-agents:start|exit 0|exit 1|exit 2|BROWSER|CODEX_BIN|--summaries|--output|--cache-dir|--codex-bin" docs/content/cli.mdx
npm run docs:check
```

All commands must exit 0.

### Step 5: Add an exact docs contract check

Create `scripts/check-cli-docs.mjs`. It must:

1. import the render helpers from `scripts/cli-options.mjs`;
2. read `docs/content/cli.mdx`;
3. extract the three marked blocks;
4. compare each block byte-for-byte after normalizing only line endings and
   outer whitespace;
5. read `package.json` and verify that the exact-version onboarding example in
   `docs/content/index.mdx` matches `packageJson.version`;
6. print a short, actionable mismatch that names the block and a command to
   print the expected text;
7. support `--print options|environment|agents` for maintainers;
8. exit 0 on a match and 1 on drift.

Create `tests/docs-contract.test.mjs` to cover:

- the checked-in docs pass;
- each renderer is deterministic;
- a helper-level altered block reports a mismatch;
- the package-version assertion catches a stale example.

Export small pure comparison/extraction helpers from the checker if needed.
Guard its command entry point so importing it in tests does not run the process.

Add:

```json
"docs:contract": "node scripts/check-cli-docs.mjs"
```

to `package.json`, then make `docs:check` run `npm run docs:contract` before the
existing Blume checks. Do not remove `blume check` or `blume validate`.

Do not add `scripts/check-cli-docs.mjs` to `package.json.files`.

**Verify**:

```sh
npm run docs:contract
node --test tests/docs-contract.test.mjs
npm run docs:check
```

All commands must exit 0.

### Step 6: Document how maintainers update the contract

In `docs/content/development.mdx`, add a short “Update CLI docs” section:

1. edit `scripts/cli-options.mjs`;
2. update parser behavior if needed;
3. print and replace the marked Markdown block;
4. update tests;
5. run `npm run docs:check`, `npm run fallow:audit`, `npm run lint`, and
   `npm test`.

In README's Local development checks, keep `npm run docs:check` from Plan 005.
Do not add generated tables to README.

Extend `tests/docs-content.test.mjs` to assert that Development names the option
record, marker-print command, and all four checks.

**Verify**:

```sh
rg -n "cli-options\\.mjs|docs:contract|npm run docs:check|npm run fallow:audit|npm run lint|npm test" docs/content/development.mdx
node --test tests/docs-content.test.mjs tests/docs-contract.test.mjs
```

Both commands must exit 0.

### Step 7: Run all repository checks

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

- Table-test every public option and its value/flag form.
- Cover advanced path forwarding and invocation-directory resolution.
- Reject no-value and duplicate `--agent`.
- Require every public option in generated help.
- Compare exact marked docs blocks with metadata renderers.
- Catch a stale package-version example.
- Extend contributor-content tests for the update workflow.
- Use `tests/cli-args.test.mjs` for parser style and
  `tests/present-help.test.mjs` for subprocess help style.
- Final focused verification:
  `node --test tests/cli-args.test.mjs tests/present-help.test.mjs tests/docs-contract.test.mjs tests/docs-content.test.mjs`
  must pass.

## Done criteria

- [ ] One immutable record lists every public option and Diffsplain-specific
      environment variable.
- [ ] Parser recognition and help sections derive from that record.
- [ ] `--agent` requires one value and rejects duplicates.
- [ ] `/cli` documents all accepted presenter options, including the four
      advanced paths.
- [ ] `/cli` has exact provider support, environment, precedence, conflict,
      default/limit, and exit-code sections.
- [ ] `npm run docs:contract` fails on a changed option table, environment
      table, agent table, or pinned onboarding version.
- [ ] `npm run docs:check` runs the contract plus both Blume checks.
- [ ] `npm pack --dry-run --json` includes every script imported by the packed
      public CLI, including `scripts/cli-options.mjs`.
- [ ] Development explains the update workflow.
- [ ] `npm run lint`, `npm test`, `npm run docs:check`, and
      `npm run fallow:audit` all exit 0.
- [ ] Compared with the recorded starting status, this plan adds no change
      outside the in-scope list.
- [ ] The plan row in `plans/README.md` says `DONE`.

## STOP conditions

Stop and report back if:

- Any prior plan has not landed or left its behavior undecided.
- An accepted presenter option has known callers that require it to remain
  undocumented/internal. Report those callers; do not remove the option or
  omit it silently.
- The option record would need to own target resolution or process behavior to
  avoid drift. Keep it declarative.
- Blume changes or strips the marker blocks in source before the contract can
  read them. The checker must read source MDX, not built output.
- A generated table cannot express an option's full safety or persistence
  effect. Keep the short generated row and add prose below it.
- A focused or full check fails twice after a reasonable fix attempt.
- The work requires a file outside the in-scope list.
- Fallow reports a new issue that cannot be fixed within this plan. Do not edit
  `.fallowrc.json` or `fallow-baselines/` to hide it.

## Maintenance notes

- Add or change a public option in the record, parser, tests, and marked docs
  block in one pull request.
- Keep narrative examples hand-written. The contract should generate facts, not
  user journeys.
- Reviewers should compare accepted parser options with the rendered list,
  especially when adding an internal builder flag.
- If a new environment variable holds a secret, document its purpose and
  precedence but never print its value in doctor, help, tests, or errors.
