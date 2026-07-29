# Plan 005: Fix doc routes and separate user commands from source commands

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8703ca8..HEAD -- README.md site/index.html docs/content/index.mdx docs/content/cli.mdx docs/content/agent-notes.mdx docs/content/data.mdx docs/content/development.mdx tests/rendered-html.test.mjs tests/docs-content.test.mjs plans/README.md`
> Plans 001-004 are expected to change several docs. Read their final text
> before moving sections. Ignore status-only edits to `plans/README.md`. Stop
> on any other unexplained mismatch.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**:
  `plans/002-state-data-and-storage-boundaries.md`,
  `plans/003-make-doctor-honest-and-add-troubleshooting.md`,
  `plans/004-define-every-review-target.md`
- **Category**: docs
- **Planned at**: commit `8703ca8`, 2026-07-29

## Why this matters

The landing page's “Read the full guide” link points to a README heading that
does not exist. The README sends users to the raw `docs/` source instead of the
published site. Product pages also show `npm run` and `node scripts/...`
commands that only work in a source checkout. This plan gives users working
routes and puts contributor commands in one Development page.

## Current state

- The docs site has a known production address:

  ```ts
  // docs/blume.config.ts:10-14
  deployment: {
    base: "/diffsplain/docs",
    output: "static",
    site: "https://itsjling.github.io",
  },
  ```

  Its published root is
  `https://itsjling.github.io/diffsplain/docs/`.

- `site/index.html:291-298` links the full guide to
  `https://github.com/itsjling/diffsplain#run-it`. The README heading is
  `## Use` (`README.md:6`), so the target anchor is absent.
- The landing-page header has a GitHub link but no docs link
  (`site/index.html:40-49`).
- `README.md:84` links to the source directory with
  `More guides are in [docs/](docs/).` A user who follows it on GitHub sees
  files, not the built docs.
- Product pages contain source-checkout commands:
  - `docs/content/cli.mdx:94-107`: `npm run diffsplain` and `npm run doctor`;
  - `docs/content/agent-notes.mdx:31-45`: `npm run summarize`;
  - `docs/content/data.mdx:15-19`, `41-50`, `58-72`, and `74-92`:
    `node scripts/build-diff-data.mjs` and demo maintenance commands.
- `docs/content/development.mdx` already owns local app, checks, release, demo,
  snapshot, and docs commands. It is the right home for source-only workflows.
- `AGENTS.md:3-6` sets the boundary:
  - root README: command use and local development only;
  - landing page: `site/`;
  - product docs: `docs/`;
  - docs changes must run `npm run docs:check`.
- README and Development list lint/tests but omit `npm run docs:check`, despite
  that repo rule and the CI step at `.github/workflows/site.yml:33-36`.
- `tests/rendered-html.test.mjs:94-117` already reads the landing HTML and checks
  its stable controls. Follow this pattern for route assertions.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Install | `npm ci` | exit 0 |
| Content tests | `node --test tests/docs-content.test.mjs tests/rendered-html.test.mjs` | all tests pass |
| Docs | `npm run docs:check` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Full tests | `npm test` | exit 0, all tests pass |

## Scope

**In scope** (the only files you should modify):

- `README.md`
- `site/index.html`
- `docs/content/index.mdx`
- `docs/content/cli.mdx`
- `docs/content/agent-notes.mdx`
- `docs/content/data.mdx`
- `docs/content/development.mdx`
- `tests/rendered-html.test.mjs`
- `tests/docs-content.test.mjs` (create)
- `plans/README.md` (status row only)

**Out of scope** (do not touch):

- Runtime command names or package scripts.
- Docs deployment config or GitHub Pages workflow. The current published base
  is valid.
- Landing-page visual design, demo behavior, CSS, or JavaScript.
- A second contributor guide.
- Generated `docs/dist/`, `docs/.blume/`, and `dist/` files.

## Git workflow

- Branch: `codex/005-doc-routes`
- Keep link tests with link changes. Keep content moves in a separate commit if
  that makes review easier.
- Match the repo's short imperative commit style.
- Do not push or open a pull request unless the operator asks.

## Steps

### Step 1: Add content-boundary and route tests

Create `tests/docs-content.test.mjs` with Node's built-in test runner. Read files
with `new URL(..., import.meta.url)` as other tests do.

Add tests that assert:

1. `README.md` contains the published docs root and does not end with a
   source-directory “more guides” link.
2. `site/index.html` contains:
   - a header docs link to the published docs root or its same-site relative
     form;
   - a full-guide link to the published `/cli` route;
   - no `#run-it` link.
3. The user product pages (`index.mdx`, `cli.mdx`, `agent-notes.mdx`,
   `data.mdx`) contain no `npm run ...` or `node scripts/...` command.
4. `development.mdx` contains the source forms for:
   - running the public CLI and doctor;
   - generating notes;
   - building/watching a snapshot;
   - rebuilding the demo;
   - running docs.
5. README and Development both name `npm run docs:check` in their check lists.

Use narrow regular expressions. Do not reject prose links to a source file when
the page explains data shape; reject executable source commands.

Also extend the landing-page case in `tests/rendered-html.test.mjs` with the two
route assertions so site regressions fail in the existing page test.

**Verify**:
`node --test tests/docs-content.test.mjs tests/rendered-html.test.mjs` must fail
only on the old links, mixed command audiences, and missing docs check.

### Step 2: Fix the landing and README routes

In `site/index.html`:

- add a visible “Docs” item in the existing masthead navigation without
  changing its layout classes;
- point it to `/diffsplain/docs/` or `./docs/`;
- change “Read the full guide” to the published CLI route
  `/diffsplain/docs/cli` or `./docs/cli`;
- keep the GitHub link for source access.

Prefer same-site relative links in the landing page so preview and production
share the Pages base. Do not use a README anchor for product help.

In `README.md`, replace the raw `docs/` link with:

```text
https://itsjling.github.io/diffsplain/docs/
```

Keep this link within the existing Local development section or as its final
line; do not add marketing sections.

**Verify**:

```sh
! rg -n "#run-it|\\]\\(docs/\\)" README.md site/index.html
rg -n "docs/|docs/cli" README.md site/index.html
node --test tests/docs-content.test.mjs tests/rendered-html.test.mjs
```

All commands must exit 0. The negative search must return no matches.

### Step 3: Move every source-only workflow to Development

Treat these as user pages:

- `docs/content/index.mdx`
- `docs/content/cli.mdx`
- `docs/content/agent-notes.mdx`
- `docs/content/data.mdx`

Commands on those pages must work from an arbitrary user checkout through
`npx diffsplain`. Remove or move:

- “Run from source” from `/cli`;
- `npm run summarize` from `/agent-notes`;
- raw snapshot/watch/demo script commands from `/data`.

Preserve useful user behavior:

- `/agent-notes` should still explain cache reuse, `--force`, and custom
  `--summaries FILE` through the public command.
- `/data` should still explain data fields, storage, network, and update flow.
- `/cli` should still contain all public target examples.

Expand `docs/content/development.mdx` with clear source sections:

1. **Run the CLI from source**
   - `npm run diffsplain -- --worktree`
   - `npm run diffsplain -- doctor`
   - `npm run doctor`
2. **Generate notes without the page**
   - the existing `npm run summarize -- ...` forms and `--force`;
   - state that this is an internal contributor workflow, not a public
     subcommand.
3. **Build and watch snapshots**
   - `npm run snapshot -- ...`;
   - the raw builder command only where it shows internal-only flags;
   - `npm run watch:diff`.
4. **Refresh demo data**
   - keep the existing `node scripts/write-todo-demo.mjs`.

Avoid copying the same command into more than one Development section.

**Verify**:

```sh
! rg -n "npm run|node scripts/" docs/content/index.mdx docs/content/cli.mdx docs/content/agent-notes.mdx docs/content/data.mdx
rg -n "npm run diffsplain|npm run doctor|npm run summarize|npm run snapshot|npm run watch:diff|write-todo-demo" docs/content/development.mdx
node --test tests/docs-content.test.mjs
npm run docs:check
```

All commands must exit 0.

### Step 4: Put the docs check in contributor instructions

Add `npm run docs:check` to the existing check block in `README.md` and
`docs/content/development.mdx`. State that contributors must run it after docs
changes. Keep `npm run lint` and `npm test`.

Do not add a new package script; it already exists at `package.json:39`.

**Verify**:

```sh
rg -n "npm run lint|npm test|npm run docs:check" README.md docs/content/development.mdx
node --test tests/docs-content.test.mjs
```

Both commands must exit 0.

### Step 5: Run all repository checks

**Verify**:

```sh
npm run lint
npm test
npm run docs:check
git status --short
```

All checks must pass. Git status may list only in-scope files and the plan index
status edit.

## Test plan

- Create `tests/docs-content.test.mjs` for published routes, audience
  boundaries, source command ownership, and contributor checks.
- Extend the existing landing HTML test with its docs routes.
- Keep tests text-based and dependency-free.
- Do not fetch the production site during tests; CI should validate checked-in
  links deterministically.
- Final focused verification:
  `node --test tests/docs-content.test.mjs tests/rendered-html.test.mjs` must
  pass.

## Done criteria

- [ ] Landing-page Docs and full-guide links reach published routes.
- [ ] No `#run-it` or README-source fallback remains.
- [ ] README links to the published docs root.
- [ ] Product user pages contain only commands that work through
      `npx diffsplain`.
- [ ] Development owns every `npm run` and `node scripts/...` workflow.
- [ ] README and Development both list `npm run docs:check`.
- [ ] Automated tests guard the route and audience boundaries.
- [ ] `npm run lint`, `npm test`, and `npm run docs:check` all exit 0.
- [ ] `git status --short` lists no file outside the in-scope list.
- [ ] The plan row in `plans/README.md` says `DONE`.

## STOP conditions

Stop and report back if:

- The published docs base in `docs/blume.config.ts` changed or is not live.
- Plans 002-004 left conflicting copies of a section and the right owner is not
  clear.
- A command shown on a user page has no public `npx diffsplain` equivalent and
  removing it would hide a required user workflow. Report that missing public
  command instead of inventing one.
- Fixing routes requires a new deployment base or workflow change.
- A focused or full check fails twice after a reasonable fix attempt.
- The work requires a file outside the in-scope list.

## Maintenance notes

- Treat `/docs/` as the product-help root and GitHub as the source root.
- Keep source-only commands on Development even when they accept the same flags
  as the public CLI.
- Reviewers should run the text tests when renaming a docs route; Blume's build
  alone cannot prove that hand-written landing URLs changed too.
- Plan 007 will add stricter CLI/reference drift checks. Keep this audience test
  separate because it protects a different rule.
