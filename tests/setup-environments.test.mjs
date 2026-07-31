import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertSetupInputsClean } from '../scripts/setup-smoke.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function git(...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

test('a linked worktree starts without dependencies or live review data', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'diffsplain-worktree-test-'));
  const worktree = join(temporaryRoot, 'checkout');

  try {
    git('worktree', 'add', '--detach', worktree, 'HEAD');
    await assert.rejects(access(join(worktree, 'node_modules')), { code: 'ENOENT' });
    await assert.rejects(
      access(join(worktree, '.cache', 'diff-data.json')),
      { code: 'ENOENT' },
    );
    const packageJson = JSON.parse(
      await readFile(join(worktree, 'package.json'), 'utf8'),
    );
    const lockfile = packageJson.packageManager.startsWith('pnpm@')
      ? 'pnpm-lock.yaml'
      : 'package-lock.json';
    assert.equal(
      await readFile(join(worktree, lockfile), 'utf8'),
      execFileSync('git', ['-C', root, 'show', `HEAD:${lockfile}`], {
        encoding: 'utf8',
      }),
    );
  } finally {
    git('worktree', 'remove', '--force', worktree);
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test('setup smoke rejects dirty package install inputs', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'diffsplain-setup-inputs-'));

  try {
    execFileSync('git', ['init', '--quiet', repository]);
    execFileSync('git', ['-C', repository, 'config', 'user.name', 'Setup Test']);
    execFileSync('git', ['-C', repository, 'config', 'user.email', 'setup@example.com']);
    await writeFile(join(repository, 'package.json'), '{"scripts":{"setup":"pnpm install --frozen-lockfile"}}\n');
    await writeFile(join(repository, 'pnpm-lock.yaml'), '{"lockfileVersion":3}\n');
    execFileSync('git', ['-C', repository, 'add', 'package.json', 'pnpm-lock.yaml']);
    execFileSync('git', ['-C', repository, 'commit', '--quiet', '-m', 'Add setup inputs']);

    await assert.doesNotReject(assertSetupInputsClean(repository));

    await writeFile(join(repository, 'pnpm-lock.yaml'), '{"lockfileVersion":2}\n');
    await assert.rejects(
      assertSetupInputsClean(repository),
      /Setup inputs have uncommitted changes/,
    );

    execFileSync('git', ['-C', repository, 'checkout', '--', 'pnpm-lock.yaml']);
    await writeFile(join(repository, '.npmrc'), 'registry=https://example.com\n');
    await assert.rejects(
      assertSetupInputsClean(repository),
      /Setup inputs have uncommitted changes/,
    );
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
});

test('Codex setup uses the clean-checkout gate without credentials', async () => {
  const [agents, packageText, development] = await Promise.all([
    readFile(join(root, 'AGENTS.md'), 'utf8'),
    readFile(join(root, 'package.json'), 'utf8'),
    readFile(join(root, 'docs', 'content', 'development.mdx'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.match(agents, /corepack pnpm run setup/);
  assert.match(agents, /corepack pnpm run check/);
  assert.equal(packageJson.scripts['cloud:check'], 'pnpm run check && pnpm run test:cloud');
  assert.match(packageJson.scripts['test:cloud'], /generate-summaries/);
  assert.match(packageJson.scripts['test:cloud'], /present-agent/);
  assert.match(development, /Codex cloud/);
  assert.match(development, /fake coding providers and a fake browser command/);
  assert.doesNotMatch(
    agents,
    /(?:OPENAI|GH|GITHUB|NPM|ANTHROPIC|COPILOT|CURSOR)_(?:API_)?(?:KEY|TOKEN|SECRET)\s*=/,
  );
});
