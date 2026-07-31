import assert from 'node:assert/strict';
import { chmod, link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { findCommand } from '../scripts/coding-agents.mjs';
import { doctorReport } from '../scripts/doctor.mjs';
import { npmCommand } from '../scripts/release.mjs';

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
