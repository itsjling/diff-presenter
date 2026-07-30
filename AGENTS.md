# AGENTS.md

- Run `npm run lint` and `npm test` after changes. Run `npm run docs:check`
  after docs changes.
- Keep the root README limited to command use and local development.
- Keep the landing page in `site/` and product docs in `docs/`.

## Clean environments

Use the same path in the main checkout, a linked worktree, a Codex-managed
worktree, and Codex cloud:

```sh
corepack enable
corepack npm run setup
corepack npm run check
```

Do not copy `node_modules`, `.cache/`, or generated snapshots between
checkouts. In cloud, run `corepack npm run cloud:check` when provider and
browser coverage matters. Its tests use fake providers and a fake browser; do
not sign in to a real provider unless the task needs a live integration.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Domain docs

This repo uses a single-context layout. See `docs/agents/domain.md`.
