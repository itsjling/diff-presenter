import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { findCommand } from '../scripts/coding-agents.mjs';
import { doctorReport } from '../scripts/doctor.mjs';
import { npmCommand } from '../scripts/release.mjs';

const builder = fileURLToPath(
  new URL('../scripts/build-diff-data.mjs', import.meta.url),
);

async function fakeCommand(directory, name) {
  if (process.platform === 'win32') {
    const path = join(directory, `${name}.EXE`);
    await link(process.execPath, path);
    return path;
  }

  const path = join(directory, name);
  await writeFile(path, '#!/bin/sh\nprintf "fake 1.0.0\\n"\n');
  await chmod(path, 0o755);
  return path;
}

test('finds deterministic fake tools with the host shell rules', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-platform-'));
  try {
    await Promise.all([
      fakeCommand(directory, 'git'),
      fakeCommand(directory, 'gh'),
      fakeCommand(directory, 'codex'),
    ]);
    const env = {
      PATH: directory,
      ...(process.platform === 'win32' ? { PATHEXT: '.EXE' } : {}),
    };

    for (const command of ['git', 'gh', 'codex']) {
      const path = await findCommand(command, {
        env,
        platform: process.platform,
      });
      assert.equal(
        basename(path).toLowerCase(),
        `${command}${process.platform === 'win32' ? '.exe' : ''}`,
      );
    }

    const report = await doctorReport({
      env,
      platform: process.platform,
      architecture: 'test-arch',
      nodeVersion: 'v22.13.0',
      nodePath: process.execPath,
    });
    assert.equal(report.ready, true);
    assert.match(report.text, /Git\s+fake 1\.0\.0|Git\s+v22\./);
    assert.match(report.text, /Codex\s+fake 1\.0\.0|Codex\s+v22\./);
    assert.match(report.text, new RegExp(`Platform: ${process.platform} test-arch`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses the host npm launcher without a shell wrapper', () => {
  assert.equal(npmCommand('linux'), 'npm');
  assert.equal(npmCommand('darwin'), 'npm');
  assert.equal(npmCommand('win32'), 'npm.cmd');
});

test('uses the checkout basename in builder output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diffsplain-platform-builder-'));
  const repo = join(root, 'platform-repo');
  const output = join(root, 'diff-data.json');

  try {
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    for (const [key, value] of [
      ['user.email', 'diffsplain@example.test'],
      ['user.name', 'Diffsplain'],
      ['commit.gpgsign', 'false'],
    ]) {
      execFileSync('git', ['-C', repo, 'config', key, value]);
    }
    await writeFile(join(repo, 'file.txt'), 'before\n');
    execFileSync('git', ['-C', repo, 'add', 'file.txt']);
    execFileSync('git', ['-C', repo, 'commit', '-qm', 'base']);
    await writeFile(join(repo, 'file.txt'), 'after\n');

    execFileSync(
      process.execPath,
      [
        builder,
        '--worktree',
        '--repo',
        repo,
        '--no-summaries',
        '--output',
        output,
      ],
      { stdio: 'pipe' },
    );

    const payload = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(payload.repo.name, basename(repo));
    assert.notEqual(payload.repo.name, repo);
    assert.equal(payload.repo.root, repo);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
