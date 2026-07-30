import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const script = new URL('../scripts/present.mjs', import.meta.url).pathname;

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function makeRepo(root, paths) {
  const repo = join(root, 'repo');
  await mkdir(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'diffsplain@example.test');
  git(repo, 'config', 'user.name', 'Diffsplain');
  git(repo, 'config', 'commit.gpgsign', 'false');
  for (const path of paths) await writeFile(join(repo, path), 'before\n');
  git(repo, 'add', ...paths);
  git(repo, 'commit', '-qm', 'base');
  for (const path of paths) await writeFile(join(repo, path), 'after\n');
  return repo;
}

async function readIfReady(read) {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

async function waitFor(read, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await readIfReady(read);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for presenter recovery');
}

function stop(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Presenter did not stop after SIGTERM')),
      5_000,
    );
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once('error', reject);
    child.kill('SIGTERM');
  });
}

function present(repo, summaries, output, codex, environment = {}) {
  return spawn(
    process.execPath,
    [
      script,
      '--repo',
      repo,
      '--worktree',
      '--summaries',
      summaries,
      '--output',
      output,
      '--codex-bin',
      codex,
      '--batch-size',
      '1',
      '--jobs',
      '1',
      '--no-browser',
      '--port',
      '0',
    ],
    {
      cwd: dirname(summaries),
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function recordedCalls(text) {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function stopIfRunning(child) {
  if (child?.exitCode === null) await stop(child);
}

test('leaves a failed agent job recoverable without retrying it in a loop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diffsplain-present-failure-'));
  const repo = await makeRepo(root, ['changed.txt']);
  const summaries = join(root, 'notes.json');
  const output = join(root, 'diff-data.json');
  const codex = join(root, 'failing-codex.mjs');
  const calls = join(root, 'calls.log');
  let presenter;

  try {
    await writeFile(
      codex,
      `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(calls)}, 'called\\n');
process.stderr.write('planned agent failure\\n');
process.exit(1);
`,
    );
    await chmod(codex, 0o755);
    presenter = present(repo, summaries, output, codex);

    const failed = await waitFor(async () => {
      const notes = JSON.parse(await readFile(summaries, 'utf8'));
      return notes.meta?.status === 'failed' ? notes : undefined;
    });
    assert.equal(failed.meta.status, 'failed');
    assert.equal(presenter.exitCode, null);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, 1);
  } finally {
    await stopIfRunning(presenter);
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps completed notes and resumes only queued work after cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diffsplain-present-resume-'));
  const repo = await makeRepo(root, ['first.txt', 'second.txt']);
  const summaries = join(root, 'notes.json');
  const output = join(root, 'diff-data.json');
  const codex = join(root, 'resumable-codex.mjs');
  const calls = join(root, 'calls.jsonl');
  let first;
  let second;

  try {
    await writeFile(
      codex,
      `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(0, 'utf8'));
const paths = input.files.map((file) => file.path);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(paths) + '\\n');
if (paths.includes('second.txt') && !process.env.DIFFSPLAIN_RESUME) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
}
const response = paths.length
  ? { files: input.files.map((file) => ({
      path: file.path,
      title: 'Note for ' + file.path,
      what: 'Explains ' + file.path + '.',
      why: 'Covers recovery.',
      details: [],
      risks: [],
    })) }
  : { change: {
      title: 'Recovered change',
      summary: 'Resumes the remaining note.',
      why: 'Keeps completed work.',
      highlights: [],
      risks: [],
    } };
process.stdout.write(JSON.stringify(response));
`,
    );
    await chmod(codex, 0o755);
    first = present(repo, summaries, output, codex);

    await waitFor(async () => {
      const notes = JSON.parse(await readFile(summaries, 'utf8'));
      const seen = recordedCalls(await readFile(calls, 'utf8'));
      return notes.files?.['first.txt'] && seen.some((paths) => paths[0] === 'second.txt')
        ? notes
        : undefined;
    });
    assert.deepEqual(await stop(first), { code: 0, signal: null });
    first = undefined;

    const partial = JSON.parse(await readFile(summaries, 'utf8'));
    assert.deepEqual(Object.keys(partial.files), ['first.txt']);
    assert.equal(partial.meta.status, 'generating');

    second = present(repo, summaries, output, codex, {
      DIFFSPLAIN_RESUME: '1',
    });
    const complete = await waitFor(async () => {
      const notes = JSON.parse(await readFile(summaries, 'utf8'));
      return notes.meta?.status === 'complete' ? notes : undefined;
    });
    assert.deepEqual(Object.keys(complete.files).sort(), ['first.txt', 'second.txt']);
    assert.equal(complete.change.title, 'Recovered change');

    const attempted = recordedCalls(await readFile(calls, 'utf8'));
    assert.equal(attempted.filter((paths) => paths[0] === 'first.txt').length, 1);
    assert.equal(attempted.filter((paths) => paths[0] === 'second.txt').length, 2);
    assert.equal(attempted.filter((paths) => paths.length === 0).length, 1);
  } finally {
    await stopIfRunning(first);
    await stopIfRunning(second);
    await rm(root, { recursive: true, force: true });
  }
});
