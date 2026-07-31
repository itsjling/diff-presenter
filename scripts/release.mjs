#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function npmCommand(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

const verifiedTarball = '.cache/diffsplain-release.tgz';

function npmInvocation(args) {
  return process.env.npm_execpath
    ? [process.execPath, [process.env.npm_execpath, ...args]]
    : [npmCommand(), args];
}

function runNpm(args) {
  const [command, commandArgs] = npmInvocation(args);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function releaseSteps(versionArgs) {
  const prerelease =
    versionArgs[0].startsWith('pre') ||
    /^[v=]?\d+\.\d+\.\d+-/.test(versionArgs[0]);
  const publishArgs = [
    'publish',
    verifiedTarball,
    '--access',
    'public',
    '--provenance',
    ...(prerelease ? ['--tag', 'next'] : []),
  ];
  return [
    ['run', 'check'],
    ['version', ...versionArgs],
    [
      'run',
      'package:verify',
      '--',
      '--release-tarball',
      verifiedTarball,
    ],
    publishArgs,
  ];
}

export function runRelease(versionArgs, run = runNpm) {
  if (!versionArgs[0] || versionArgs[0].startsWith('-')) {
    throw new Error(
      'Usage: npm run release -- <version> [npm version options]',
    );
  }

  for (const args of releaseSteps(versionArgs)) {
    const status = run(args);
    if (status !== 0) return status;
  }
  return 0;
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.GITHUB_ACTIONS !== 'true') {
      throw new Error('Releases run only in the protected GitHub Actions workflow.');
    }
    console.log(`Tested commit: ${spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()}`);
    process.exitCode = runRelease(process.argv.slice(2));
    if (process.exitCode === 0) {
      const [command, commandArgs] = npmInvocation(['pkg', 'get', 'version']);
      const version = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8' }).stdout.trim();
      console.log(
        `Registry result: published diffsplain ${version} with provenance. Recovery: if the later Git push fails, inspect the release commit and tag, then push them without republishing.`,
      );
    } else {
      console.error('Registry result: not published. Recovery: fix the named stage, then restart the protected workflow. If versioning already ran, inspect the local commit and tag before retrying.');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
