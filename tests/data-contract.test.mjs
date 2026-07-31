import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const builder = new URL('../scripts/build-diff-data.mjs', import.meta.url).pathname;

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function build(repo, root, name, args) {
  const output = join(root, `${name}.json`);
  execFileSync(
    process.execPath,
    [builder, '--repo', repo, ...args, '--output', output],
    { encoding: 'utf8', stdio: 'pipe' },
  );
  return JSON.parse(await readFile(output, 'utf8'));
}

test('documents each supported target and its settled refresh contract', async () => {
  const data = await readFile(new URL('../docs/content/data.mdx', import.meta.url), 'utf8');
  for (const target of ['--worktree', 'Current checkout', '--base REF --head REF', '--branch NAME', '--pr NUMBER']) {
    assert.match(data, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(data, /Remote data every 30 seconds/);
  assert.match(data, /It does not receive files\s+outside that snapshot/);
  assert.match(data, /--output FILE[\s\S]*stays at the chosen path until you delete it/);
  assert.match(data, /platform user cache/);
  assert.match(data, /installed package's\s+`\.cache\/git` folder/);
  assert.doesNotMatch(data, /node scripts\//);
  assert.doesNotMatch(data, /worktree notes persist in the selected repo/i);
});

test('keeps checkout, worktree, and exact-range Git semantics distinct', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diffsplain-data-contract-'));
  const repo = join(root, 'repo');

  try {
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    git(repo, 'config', 'user.email', 'diffsplain@example.test');
    git(repo, 'config', 'user.name', 'Diffsplain');
    git(repo, 'config', 'commit.gpgsign', 'false');
    await writeFile(join(repo, 'base.txt'), 'base\n');
    git(repo, 'add', 'base.txt');
    git(repo, 'commit', '-qm', 'base');
    const base = git(repo, 'rev-parse', 'HEAD');

    git(repo, 'switch', '-qc', 'feature');
    await writeFile(join(repo, 'committed.txt'), 'committed\n');
    git(repo, 'add', 'committed.txt');
    git(repo, 'commit', '-qm', 'feature');
    const head = git(repo, 'rev-parse', 'HEAD');

    await writeFile(join(repo, 'staged.txt'), 'staged\n');
    git(repo, 'add', 'staged.txt');
    await writeFile(join(repo, 'base.txt'), 'unstaged\n');
    await writeFile(join(repo, 'untracked.txt'), 'untracked\n');

    const checkout = await build(repo, root, 'checkout', ['--checkout']);
    const worktree = await build(repo, root, 'worktree', ['--worktree']);
    const range = await build(repo, root, 'range', ['--base', base, '--head', head]);

    assert.deepEqual(
      checkout.files.map(({ path }) => path),
      ['base.txt', 'committed.txt', 'staged.txt', 'untracked.txt'],
    );
    assert.equal(checkout.repo.target.kind, 'checkout');
    assert.equal(checkout.repo.base, base);
    assert.equal(checkout.repo.head, head);

    assert.deepEqual(
      worktree.files.map(({ path }) => path),
      ['base.txt', 'staged.txt', 'untracked.txt'],
    );
    assert.equal(worktree.repo.target.kind, 'worktree');
    assert.equal(worktree.repo.base, head);
    assert.equal(worktree.repo.head, head);

    assert.deepEqual(
      range.files.map(({ path }) => path),
      ['committed.txt'],
    );
    assert.equal(range.repo.target.kind, 'range');
    assert.equal(range.repo.base, base);
    assert.equal(range.repo.head, head);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
