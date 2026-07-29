import assert from 'node:assert/strict';
import test from 'node:test';
import { runRelease } from '../scripts/release.mjs';

test('bumps and publishes while passing version arguments through', () => {
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
    ['version', 'prerelease', '--preid', 'beta'],
    ['publish', '--access', 'public'],
  ]);
});

test('stops before publishing when the version bump fails', () => {
  const calls = [];
  const status = runRelease(['patch'], (args) => {
    calls.push(args);
    return args[0] === 'version' ? 1 : 0;
  });

  assert.equal(status, 1);
  assert.deepEqual(calls, [['version', 'patch']]);
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
