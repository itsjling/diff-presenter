#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runNpm(args) {
  const result = spawnSync(npm, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function runRelease(versionArgs, run = runNpm) {
  if (!versionArgs[0] || versionArgs[0].startsWith('-')) {
    throw new Error(
      'Usage: npm run release -- <version> [npm version options]',
    );
  }

  const steps = [
    ['version', ...versionArgs],
    ['publish', '--access', 'public'],
  ];
  for (const args of steps) {
    const status = run(args);
    if (status !== 0) return status;
  }
  return 0;
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runRelease(process.argv.slice(2));
    if (process.exitCode === 0) {
      console.log(
        'Published. Push the version commit and tag with: git push origin main --follow-tags',
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
