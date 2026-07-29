import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('../scripts/present.mjs', import.meta.url).pathname;

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function makeRepo(root, name, file) {
  const repo = join(root, name);
  await mkdir(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'diffsplain@example.test');
  git(repo, 'config', 'user.name', 'Diffsplain');
  await writeFile(join(repo, file), 'before\n');
  git(repo, 'add', file);
  git(repo, 'commit', '-qm', 'base');
  await writeFile(join(repo, file), 'after\n');
  return repo;
}

function waitForUrl(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`Presenter did not start: ${output}`));
    }, 12_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/Diffsplain: (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Presenter exited with ${code}: ${output}`));
    });
  });
}

async function waitFor(read, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error('Timed out waiting for presenter data');
}

function stop(child) {
  return new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
    child.kill('SIGTERM');
  });
}

test('keeps simultaneous presenters on separate ports and data files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diffsplain-instances-'));
  const browser = join(root, 'browser');
  const browserLog = join(root, 'browser.log');
  let first;
  let second;

  try {
    const firstRepo = await makeRepo(root, 'repo-one', 'one.txt');
    const secondRepo = await makeRepo(root, 'repo-two', 'two.txt');
    await writeFile(
      browser,
      '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$BROWSER_LOG"\n',
    );
    await chmod(browser, 0o755);

    const environment = {
      ...process.env,
      BROWSER: browser,
      BROWSER_LOG: browserLog,
    };
    first = spawn(
      process.execPath,
      [script, '--repo', firstRepo, '--worktree', '--no-agent'],
      { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    second = spawn(
      process.execPath,
      [script, '--repo', secondRepo, '--worktree', '--no-agent'],
      { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const [firstUrl, secondUrl] = await Promise.all([
      waitForUrl(first),
      waitForUrl(second),
    ]);
    assert.notEqual(new URL(firstUrl).port, new URL(secondUrl).port);

    const [firstData, secondData] = await Promise.all([
      waitFor(async () => {
        const response = await fetch(`${firstUrl}/diff-data.json`);
        return response.ok ? response.json() : undefined;
      }),
      waitFor(async () => {
        const response = await fetch(`${secondUrl}/diff-data.json`);
        return response.ok ? response.json() : undefined;
      }),
    ]);
    assert.equal(firstData.repo.name, 'repo-one');
    assert.deepEqual(firstData.files.map((file) => file.path), ['one.txt']);
    assert.equal(secondData.repo.name, 'repo-two');
    assert.deepEqual(secondData.files.map((file) => file.path), ['two.txt']);

    const opened = await waitFor(async () => {
      const urls = (await readFile(browserLog, 'utf8')).trim().split('\n');
      return urls.length === 2 ? urls : undefined;
    });
    assert.deepEqual(new Set(opened), new Set([firstUrl, secondUrl]));
  } finally {
    if (first && first.exitCode === null) await stop(first);
    if (second && second.exitCode === null) await stop(second);
    await rm(root, { recursive: true, force: true });
  }
});
