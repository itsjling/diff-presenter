import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createSupportRecorder,
  safeCommandVersion,
  versionEnvironment,
  writeSupportRecord,
} from '../scripts/support-record.mjs';

test('keeps only system values in the version probe environment', () => {
  assert.deepEqual(
    versionEnvironment({
      HOME: '/private/user',
      PATH: '/bin',
      PROVIDER_TOKEN: 'token-value',
      SYSTEMROOT: 'C:\\Windows',
    }),
    {
      PATH: '/bin',
      SYSTEMROOT: 'C:\\Windows',
    },
  );
});

test('extracts only a provider version from command output', () => {
  let probed;
  const version = safeCommandVersion('codex', 'codex-test', {
    env: {
      PATH: '/bin',
      SECRET_ENV: 'environment-secret',
    },
    run(command, args, options) {
      probed = { command, args, env: options.env };
      return {
        status: 0,
        stdout:
          'codex-cli 9.8.7 path=/private/source token=provider-secret\n',
      };
    },
  });

  assert.equal(version, '9.8.7');
  assert.deepEqual(probed, {
    command: 'codex-test',
    args: ['--version'],
    env: { PATH: '/bin' },
  });
});

test('builds one fixed-size failed-run record', () => {
  let tick = 100;
  const recorder = createSupportRecorder({
    provider: 'codex',
    providerVersion: '9.8.7',
    runId: '12345678-1234-4234-8234-123456789abc',
    now: () => new Date('2026-07-31T01:02:03.000Z'),
    clock: () => tick,
  });
  recorder.addBytes('snapshot', 4_000);
  recorder.addBytes('agentInput', 2_000);
  recorder.addBytes('agentOutput', 500);
  tick = 112;
  recorder.addStage('snapshot', 12);
  tick = 142;
  recorder.addStage('agent', 30, 'failed');
  tick = 160;

  const record = recorder.failure(1);

  assert.equal(record.schemaVersion, 1);
  assert.equal(record.runId, '12345678-1234-4234-8234-123456789abc');
  assert.equal(record.startedAt, '2026-07-31T01:02:03.000Z');
  assert.equal(record.durationMs, 60);
  assert.deepEqual(record.provider, {
    name: 'codex',
    version: '9.8.7',
  });
  assert.match(record.tools.diffsplain, /^\d+\.\d+\.\d+$/);
  assert.match(record.tools.node, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(record.stages, {
    snapshot: { durationMs: 12, calls: 1, state: 'ok' },
    agent: { durationMs: 30, calls: 1, state: 'failed' },
  });
  assert.deepEqual(record.bytes, {
    snapshot: 4_000,
    agentInput: 2_000,
    agentOutput: 500,
  });
  assert.deepEqual(record.exit, {
    state: 'failed',
    code: 1,
    stage: 'agent',
  });
  assert.ok(Buffer.byteLength(JSON.stringify(record)) < 4_096);

  const oversized = createSupportRecorder({
    provider: 'codex',
    providerVersion: `1.2.3-${'a'.repeat(1_000)}`,
  }).failure();
  assert.equal(oversized.provider.version, null);
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) < 4_096);
});

test('merges overlapping stage intervals', () => {
  let tick = 0;
  const recorder = createSupportRecorder({
    clock: () => tick,
  });
  const finishFirst = recorder.startStage('agent');
  tick = 10;
  const finishSecond = recorder.startStage('agent');
  tick = 30;
  finishFirst();
  tick = 40;
  finishSecond('failed');
  tick = 50;

  const record = recorder.failure();

  assert.equal(record.durationMs, 50);
  assert.deepEqual(record.stages.agent, {
    durationMs: 40,
    calls: 2,
    state: 'failed',
  });
  assert.ok(record.stages.agent.durationMs <= record.durationMs);
});

test('updates the provider and keeps the observed exit code', () => {
  const recorder = createSupportRecorder();
  recorder.setProvider('codex', '8.7.6');

  const record = recorder.failure(127);

  assert.deepEqual(record.provider, {
    name: 'codex',
    version: '8.7.6',
  });
  assert.deepEqual(record.exit, {
    state: 'failed',
    code: 127,
    stage: 'unknown',
  });
});

test('writes exported records with private permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-support-'));
  const output = join(directory, 'support.json');
  const recorder = createSupportRecorder({
    provider: 'codex',
    providerVersion: '1.2.3',
  });

  try {
    writeSupportRecord(output, recorder.failure());
    const mode = (await stat(output)).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).schemaVersion, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
