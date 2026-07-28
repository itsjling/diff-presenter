# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers reviewing code changes. They need to understand each diff quickly without losing key facts, reasons, or risks.

## Product Purpose

Diff Presenter makes code changes clear by showing one changed file at a time with concise, comprehensive notes from a coding agent. It succeeds when a developer can understand the change and review it with less effort.

## Positioning

Diff Presenter pairs each unified diff with agent-written context about what changed, why it changed, useful details, and risks. It keeps that context beside the code instead of making the developer piece it together from a separate chat or a raw patch.

## Operating Context

Developers run the app against a local Git workspace, an exact ref range, a remote branch, or a GitHub pull request. They move through changed files, search the file list, and expand long patches when needed. The page updates as Git state or agent notes change.

## Capabilities and Constraints

- Show tracked and untracked worktree changes against `HEAD`.
- Show exact local ranges, remote branches, and GitHub pull requests.
- Present full or shortened unified diffs, including binary-file metadata.
- Pair the whole change and each file with agent-written summaries, reasons, details, and risks.
- Keep local review read-only: the app must not change the target repo.
- Keep notes concise without dropping facts needed for a sound review.
- Treat the final product name and scope as open decisions.

## Brand Commitments

Use the name “Diff Presenter” for now. Keep the current local, read-only product scope until the user changes it. The final name and scope remain work in progress.

## Evidence on Hand

- `README.md` documents the current product, supported review targets, commands, and data flow.
- `app/page.tsx` contains the working review interface and its loading, empty, search, navigation, and long-diff states.
- `public/diff-data.json` contains a real 57-file pull-request review with change and file notes.
- `data/pr-198-summaries.json` contains detailed agent-written notes used by the demo.
- Tests cover rendering, remote targets, summary paths, agent notes, and snapshot generation.
- No confirmed testimonials, customer claims, pricing, or benchmark data exists in this repo; future work must not invent them.

## Product Principles

1. Make every diff easy to scan and understand.
2. Keep agent notes short, complete, and tied to the code in view.
3. Preserve the developer’s repo and review state.
4. Support real review targets without forcing branch changes.
5. State uncertainty and risk instead of hiding them.
