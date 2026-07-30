import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { doctorReport } from '../scripts/doctor.mjs';

const script = new URL('../scripts/present.mjs', import.meta.url).pathname;

async function fakeCommand(
  directory,
  name,
  { authStatus = 1, versionStatus = 0 } = {},
) {
  const path = join(directory, name);
  await writeFile(
    path,
    `#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\\n' ${JSON.stringify(`${name} version test`)}; exit ${versionStatus}; fi
if [ "$1" = "--help" ]; then exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ] && [ "$3" = "--active" ]; then exit ${authStatus}; fi
exit 9
`,
  );
  await chmod(path, 0o755);
}

async function withCommands(commands, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-doctor-'));
  try {
    await Promise.all(Object.entries(commands).map(([name, options]) => fakeCommand(directory, name, options)));
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function options(directory, deep = false) {
  return {
    env: { PATH: directory },
    platform: process.platform,
    architecture: 'test-arch',
    nodeVersion: 'v22.13.0',
    nodePath: '/test/node',
    deep,
  };
}

test('reports core review independently from optional capabilities', async () => {
  await withCommands({ git: {} }, async (directory) => {
    const report = await doctorReport(options(directory));

    assert.equal(report.ready, true);
    assert.equal(report.json.capabilities.coreReview.compatible, 'yes');
    assert.equal(report.json.capabilities.coreReview.smokeTest, 'not-run');
    assert.equal(report.json.capabilities.agentNotes.codex.installed, false);
    assert.equal(report.json.capabilities.pullRequestLookup.installed, false);
    assert.equal(report.json.capabilities.agentNotes.codex.smokeTest, 'not-run');
    assert.match(report.text, /No agent is required for a plain local review; use --no-agent/);
  });
});

test('keeps installation, compatibility, authentication, and smoke tests separate', async () => {
  await withCommands(
    { git: {}, gh: { authStatus: 0 }, 'cursor-agent': {} },
    async (directory) => {
      const report = await doctorReport(options(directory));
      const cursor = report.json.capabilities.agentNotes.cursor;

      assert.equal(cursor.installed, true);
      assert.equal(cursor.compatible, 'not-verified');
      assert.equal(cursor.authenticated, 'not-checked');
      assert.equal(cursor.smokeTest, 'not-run');
      assert.equal(report.json.capabilities.pullRequestLookup.authenticated, 'passed');
      assert.match(report.text, /Agent notes: Cursor[\s\S]*authenticated\s+not-checked/);
    },
  );
});

test('runs only explicit deep local command checks', async () => {
  await withCommands({ git: {}, 'cursor-agent': {} }, async (directory) => {
    const report = await doctorReport(options(directory, true));

    assert.equal(
      report.json.capabilities.agentNotes.cursor.smokeTest,
      'passed (local command only)',
    );
    assert.equal(
      report.json.capabilities.coreReview.smokeTest,
      'passed (local command only)',
    );
  });
});

test('requires a successful Git version probe for core readiness', async () => {
  await withCommands({ git: { versionStatus: 1 } }, async (directory) => {
    const report = await doctorReport(options(directory));

    assert.equal(report.json.capabilities.coreReview.installed, true);
    assert.equal(report.json.capabilities.coreReview.compatible, 'no');
    assert.equal(report.json.capabilities.coreReview.ready, false);
    assert.equal(report.ready, false);
  });
});

test('prints a stable JSON report and warns before deep checks', async () => {
  await withCommands({ git: {} }, async (directory) => {
    const result = spawnSync(process.execPath, [script, 'doctor', '--json', '--deep'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: directory, CODEX_BIN: '', CLAUDE_BIN: '', COPILOT_BIN: '', CURSOR_BIN: '', OPENCODE_BIN: '' },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Warning: deep checks run local provider commands/);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.deep, true);
    assert.equal(report.capabilities.coreReview.ready, true);
    assert.deepEqual(Object.keys(report.capabilities.agentNotes), ['codex', 'claude', 'copilot', 'cursor', 'opencode']);
  });
});

test('fails only when core local review is unavailable', () => {
  const result = spawnSync(process.execPath, [script, 'doctor'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '', CODEX_BIN: '', CLAUDE_BIN: '', COPILOT_BIN: '', CURSOR_BIN: '', OPENCODE_BIN: '' },
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Plain local review/);
});
