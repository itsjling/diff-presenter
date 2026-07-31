import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runRelease } from '../scripts/release.mjs';

const releaseScript = new URL('../scripts/release.mjs', import.meta.url).pathname;

test('checks, versions, verifies, and publishes with provenance', () => {
  const calls = [];
  const status = runRelease(
    ['prerelease', '--preid', 'beta'],
    (args) => {
      calls.push(args);
      return 0;
    },
  );

  assert.equal(status, 0);
  assert.deepEqual(calls, [
    ['run', 'check'],
    ['version', 'prerelease', '--preid', 'beta'],
    [
      'run',
      'package:verify',
      '--',
      '--release-tarball',
      '.cache/diffsplain-release.tgz',
    ],
    [
      'publish',
      '.cache/diffsplain-release.tgz',
      '--access',
      'public',
      '--provenance',
      '--tag',
      'next',
    ],
  ]);
});

test('publishes stable versions under the default dist-tag', () => {
  const calls = [];
  const status = runRelease(['1.2.3'], (args) => {
    calls.push(args);
    return 0;
  });

  assert.equal(status, 0);
  assert.deepEqual(calls.at(-1), [
    'publish',
    '.cache/diffsplain-release.tgz',
    '--access',
    'public',
    '--provenance',
  ]);
});

test('stops before versioning when the product gate fails', () => {
  const calls = [];
  const status = runRelease(['patch'], (args) => {
    calls.push(args);
    return args[0] === 'run' && args[1] === 'check' ? 1 : 0;
  });

  assert.equal(status, 1);
  assert.deepEqual(calls, [['run', 'check']]);
});

test('requires the version before any npm version options', () => {
  assert.throws(
    () => runRelease([]),
    /npm run release -- <version>/,
  );
  assert.throws(
    () => runRelease(['--preid', 'beta', 'prerelease']),
    /npm run release -- <version>/,
  );
});

test('rejects a local release before it can version or publish', () => {
  const result = spawnSync(process.execPath, [releaseScript, 'patch'], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'false' },
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Releases run only in the protected GitHub Actions workflow/);
});

test('uses a protected trusted-publishing workflow', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: npm-publish/);
  assert.match(workflow, /group: npm-release/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /git fetch --no-tags origin main/);
  assert.match(
    workflow,
    /git rev-parse HEAD.*git rev-parse origin\/main/,
  );
  assert.match(workflow, /RELEASE_VERSION: \$\{\{ inputs\.version \}\}/);
  assert.match(workflow, /run: corepack npm@11\.5\.1 run release -- "\$RELEASE_VERSION"/);
  assert.match(workflow, /corepack npm@11\.5\.1 run release/);
  assert.match(workflow, /git push origin HEAD:main --follow-tags/);
});
