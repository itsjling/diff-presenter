import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { parseCliArgs } from '../scripts/cli-args.mjs';

const cwd = '/work/project';
const missing = () => false;

test('defaults to the current checkout and Codex', () => {
  const parsed = parseCliArgs([], {
    callerDirectory: cwd,
    pathExists: missing,
  });

  assert.equal(parsed.agentEnabled, true);
  assert.equal(parsed.agent, 'codex');
  assert.equal(parsed.port, 2299);
  assert.equal(parsed.portWasPassed, false);
  assert.deepEqual(parsed.feedArgs, ['--repo', cwd, '--checkout']);
  assert.deepEqual(parsed.agentArgs, ['--repo', cwd, '--checkout']);
});

test('accepts a GitHub owner/name repo and a branch', () => {
  const parsed = parseCliArgs(['acme/widgets', '--branch', 'feature/search'], {
    callerDirectory: cwd,
    pathExists: missing,
  });

  assert.deepEqual(parsed.feedArgs, [
    '--repo',
    cwd,
    '--branch',
    'feature/search',
    '--remote',
    'https://github.com/acme/widgets.git',
  ]);
});

test('accepts a repo URL and pull request', () => {
  const parsed = parseCliArgs(
    [
      '--repo',
      'https://github.com/acme/widgets',
      '--pr',
      '42',
      '--no-agent',
      '--port',
      '4000',
    ],
    { callerDirectory: cwd, pathExists: missing },
  );

  assert.equal(parsed.agentEnabled, false);
  assert.equal(parsed.port, 4000);
  assert.equal(parsed.portWasPassed, true);
  assert.deepEqual(parsed.feedArgs, [
    '--repo',
    cwd,
    '--pr',
    '42',
    '--remote',
    'https://github.com/acme/widgets',
  ]);
});

test('keeps an existing repo path local', () => {
  const parsed = parseCliArgs(['repos/widgets', '--pr', '42'], {
    callerDirectory: cwd,
    pathExists: (path) => path === resolve(cwd, 'repos/widgets'),
  });

  assert.deepEqual(parsed.feedArgs, [
    '--repo',
    resolve(cwd, 'repos/widgets'),
    '--pr',
    '42',
  ]);
});

test('gets the repo from a full pull request URL', () => {
  const parsed = parseCliArgs(
    ['--pr', 'https://github.com/acme/widgets/pull/42'],
    { callerDirectory: cwd, pathExists: missing },
  );

  assert.deepEqual(parsed.feedArgs, [
    '--repo',
    cwd,
    '--pr',
    'https://github.com/acme/widgets/pull/42',
    '--remote',
    'https://github.com/acme/widgets.git',
  ]);
});

test('rejects remote repos without a branch or pull request', () => {
  assert.throws(
    () =>
      parseCliArgs(['acme/widgets'], {
        callerDirectory: cwd,
        pathExists: missing,
      }),
    /remote repo needs --branch or --pr/i,
  );
});

test('accepts only the Codex agent for now', () => {
  assert.throws(
    () =>
      parseCliArgs(['--agent', 'claude'], {
        callerDirectory: cwd,
        pathExists: missing,
      }),
    /only "codex" is supported/i,
  );
});

test('passes agent model, reasoning, and batch settings through', () => {
  const parsed = parseCliArgs(
    [
      '--model',
      'gpt-test',
      '--reasoning',
      'low',
      '--batch-size',
      '2',
    ],
    {
      callerDirectory: cwd,
      pathExists: missing,
    },
  );

  assert.deepEqual(parsed.agentArgs.slice(-6), [
    '--model',
    'gpt-test',
    '--reasoning',
    'low',
    '--batch-size',
    '2',
  ]);
});

test('forces note regeneration only in the agent process', () => {
  const parsed = parseCliArgs(['--force'], {
    callerDirectory: cwd,
    pathExists: missing,
  });

  assert.equal(parsed.forceSummaryRegeneration, true);
  assert.doesNotMatch(parsed.feedArgs.join(' '), /--force/);
  assert.equal(parsed.agentArgs.at(-1), '--force');
});

test('rejects invalid reasoning and batch settings', () => {
  assert.throws(
    () =>
      parseCliArgs(['--reasoning', 'fast'], {
        callerDirectory: cwd,
        pathExists: missing,
      }),
    /--reasoning must be/i,
  );
  assert.throws(
    () =>
      parseCliArgs(['--batch-size', '0'], {
        callerDirectory: cwd,
        pathExists: missing,
      }),
    /--batch-size must be/i,
  );
});

test('publishes the diffsplain executable', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );

  assert.equal(packageJson.private, undefined);
  assert.equal(packageJson.bin['diffsplain'], 'scripts/present.mjs');
  assert.ok(packageJson.files.includes('dist'));
  assert.ok(packageJson.scripts.prepack);
});
