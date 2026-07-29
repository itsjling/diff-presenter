import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { doctorReport } from '../scripts/doctor.mjs';

const script = new URL('../scripts/present.mjs', import.meta.url).pathname;

async function fakeCommand(directory, name, version) {
  const path = join(directory, name);
  await writeFile(
    path,
    `#!/bin/sh
printf '%s\\n' ${JSON.stringify(version)}
`,
  );
  await chmod(path, 0o755);
}

test('reports versions and each supported coding agent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-doctor-'));
  try {
    await fakeCommand(directory, 'git', 'git version 2.50.0');
    await fakeCommand(directory, 'gh', 'gh version 2.80.0');
    await fakeCommand(directory, 'cursor-agent', '2026.07.29-test');

    const report = await doctorReport({
      env: { PATH: directory },
      platform: process.platform,
      architecture: 'test-arch',
      nodeVersion: 'v22.13.0',
      nodePath: '/test/node',
    });

    assert.equal(report.ready, true);
    assert.match(report.text, /Node\s+v22\.13\.0/);
    assert.match(report.text, /Git\s+git version 2\.50\.0/);
    assert.match(report.text, /gh\s+gh version 2\.80\.0/);
    assert.match(report.text, /Coding agents \(1 installed\)/);
    assert.match(report.text, /✓ Cursor\s+2026\.07\.29-test/);
    for (const agent of ['Codex', 'Claude', 'Copilot', 'OpenCode']) {
      assert.match(report.text, new RegExp(`✗ ${agent}\\s+not found`));
    }
    assert.match(report.text, /Agent notes are ready with Cursor/);
    assert.match(report.text, /Platform: \S+ test-arch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('clearly reports when no supported coding agent is installed', () => {
  const result = spawnSync(process.execPath, [script, 'doctor'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: '',
      CODEX_BIN: '',
      CLAUDE_BIN: '',
      COPILOT_BIN: '',
      CURSOR_BIN: '',
      OPENCODE_BIN: '',
    },
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /^Diffsplain doctor/m);
  assert.match(result.stdout, /Coding agents \(none installed\)/);
  assert.match(
    result.stdout,
    /No supported coding agent is installed/,
  );
  assert.match(result.stdout, /gh\s+not found/);
});
