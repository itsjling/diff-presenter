import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = new URL('../scripts/present.mjs', import.meta.url).pathname;

test('prints help with either help flag', () => {
  for (const flag of ['-h', '--help']) {
    const result = spawnSync(process.execPath, [script, flag], {
      encoding: 'utf8',
      env: { ...process.env, PATH: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Usage: diffsplain/m);
    assert.match(result.stdout, /-v, --version/);
  }
});

test('prints the package version with either version flag', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  for (const flag of ['-v', '--version']) {
    const result = spawnSync(process.execPath, [script, flag], {
      encoding: 'utf8',
      env: { ...process.env, PATH: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `diffsplain ${packageJson.version}`);
  }
});

test('fails before startup when no coding agent is installed', () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no coding agent is available/i);
});
