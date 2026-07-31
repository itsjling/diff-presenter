import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ledger = new URL('../plans/README.md', import.meta.url);

test('records the divergent plan stack as reconciled or rejected', async () => {
  const content = await readFile(ledger, 'utf8');

  assert.doesNotMatch(content, /The final branch contains each accepted plan commit/i);
  for (const plan of ['001', '002', '003', '004', '005', '006', '007']) {
    assert.match(content, new RegExp(`\\[${plan}\\][^\\n]+\\| (?:RECONCILED|REJECTED) \\|`));
    assert.match(content, new RegExp(`\\| ${plan} \\| (?:Reconciled|Rejected) \\|`));
  }
  for (const pullRequest of ['#43', '#44', '#66', '#69']) {
    assert.match(content, new RegExp(`PRs? [^\\n]*${pullRequest}`));
  }
  for (const staleCommit of ['2a64e36', 'e6540db']) {
    assert.doesNotMatch(content, new RegExp(staleCommit));
  }
});

test('records the stale-worktree audit and reclaimed space', async () => {
  const content = await readFile(ledger, 'utf8');

  assert.match(content, /seven `codex\/00\*-\*` plan worktrees were checked/i);
  assert.match(content, /5,651,140 KiB/);
  assert.match(content, /Issue worktrees were not candidates for removal/);
});
