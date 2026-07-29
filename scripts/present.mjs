#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { helpText, parseCliArgs } from './cli-args.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const callerDirectory = process.cwd();
let cli;
try {
  cli = parseCliArgs(process.argv.slice(2), { callerDirectory });
} catch (error) {
  console.error(error.message);
  console.error('Run diff-presenter --help for usage.');
  process.exit(2);
}

if (cli.help) {
  console.log(helpText);
  process.exit(0);
}

const { agentEnabled, port } = cli;
const feedArgs = [...cli.feedArgs];
const agentArgs = [...cli.agentArgs];
const outputIndex = feedArgs.indexOf('--output');

if (outputIndex === -1) {
  feedArgs.push('--output', resolve(root, 'public/diff-data.json'));
  agentArgs.push('--output', resolve(root, 'public/diff-data.json'));
}
if (!feedArgs.includes('--watch')) feedArgs.push('--watch');
const outputPath = resolve(
  callerDirectory,
  feedArgs[feedArgs.indexOf('--output') + 1],
);

const feed = spawn(
  process.execPath,
  [resolve(root, 'scripts/build-diff-data.mjs'), ...feedArgs],
  {
    cwd: callerDirectory,
    stdio: agentEnabled
      ? ['inherit', 'pipe', 'inherit']
      : ['inherit', 'inherit', 'inherit'],
  },
);
const builtServer = resolve(root, 'dist/server/index.js');
const site = existsSync(builtServer)
  ? spawn(
      process.execPath,
      [
        resolve(root, 'scripts/serve-built.mjs'),
        '--output',
        outputPath,
        '--port',
        String(port),
      ],
      { cwd: root, stdio: 'inherit' },
    )
  : spawn(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'dev', '--', '--port', String(port)],
      { cwd: root, stdio: 'inherit' },
    );
let closing = false;
let agent;
let agentTimer;
let agentFingerprint;
let queuedFingerprint;

function snapshotState() {
  try {
    const snapshot = JSON.parse(readFileSync(outputPath, 'utf8'));
    if (snapshot.notes?.reviewFingerprint) {
      const fingerprint = snapshot.notes.reviewFingerprint;
      return {
        fingerprint,
        hasCurrentAgentNotes:
          snapshot.notes.complete &&
          snapshot.notes.fresh &&
          snapshot.notes.generatedFor === fingerprint,
      };
    }
    const reviewData = {
      repo: {
        name: snapshot.repo.name,
        base: snapshot.repo.base,
        head: snapshot.repo.head,
        branch: snapshot.repo.branch,
        baseBranch: snapshot.repo.baseBranch,
        remote: snapshot.repo.remote,
        targetKind: snapshot.repo.target?.kind,
      },
      change: {
        title: snapshot.change.title,
        number: snapshot.change.number,
      },
      files: snapshot.files.map((file) => ({
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        isBinary: file.isBinary,
        patch: file.patch,
      })),
    };
    return {
      fingerprint: createHash('sha256')
        .update(JSON.stringify(reviewData))
        .digest('hex'),
      hasCurrentAgentNotes: false,
    };
  } catch {
    return undefined;
  }
}

function snapshotFingerprint() {
  return snapshotState()?.fingerprint;
}

function runAgent(fingerprint) {
  if (closing || !agentEnabled) return;
  if (agent) {
    queuedFingerprint = fingerprint;
    return;
  }
  agentFingerprint = fingerprint;
  const child = spawn(
    process.execPath,
    [resolve(root, 'scripts/generate-summaries.mjs'), ...agentArgs],
    { cwd: callerDirectory, stdio: 'inherit' },
  );
  agent = child;
  let settled = false;
  const finish = (code, signal, error) => {
    if (settled) return;
    settled = true;
    const finishedFingerprint = agentFingerprint;
    if (agent === child) agent = undefined;
    agentFingerprint = finishedFingerprint;
    if (!closing && (error || code || signal)) {
      if (error) console.error(error.message);
      console.error(
        'The coding agent could not write notes. The diff page will stay open.',
      );
    }
    const latest = queuedFingerprint || snapshotFingerprint();
    queuedFingerprint = undefined;
    if (latest && latest !== finishedFingerprint) scheduleAgent(latest);
  };
  child.on('error', (error) => finish(1, undefined, error));
  child.on('exit', (code, signal) => finish(code, signal));
}

function scheduleAgent(fingerprint) {
  const state = snapshotState();
  const selectedFingerprint = fingerprint || state?.fingerprint;
  if (
    !agentFingerprint &&
    state?.hasCurrentAgentNotes &&
    selectedFingerprint === state.fingerprint
  ) {
    agentFingerprint = selectedFingerprint;
    return;
  }
  if (!selectedFingerprint || selectedFingerprint === agentFingerprint) return;
  if (agent) {
    queuedFingerprint = selectedFingerprint;
    return;
  }
  clearTimeout(agentTimer);
  agentTimer = setTimeout(() => runAgent(selectedFingerprint), 2_500);
}

if (agentEnabled && feed.stdout) {
  let feedOutput = '';
  feed.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    feedOutput += text;
    const lines = feedOutput.split('\n');
    feedOutput = lines.pop() || '';
    if (
      lines.some(
        (line) =>
          line.startsWith('Wrote ') || line === 'No diff-data changes',
      )
    ) {
      scheduleAgent();
    }
  });
}

function stop(code = 0) {
  if (closing) return;
  closing = true;
  clearTimeout(agentTimer);
  if (!feed.killed) feed.kill('SIGTERM');
  if (!site.killed) site.kill('SIGTERM');
  if (agent && !agent.killed) agent.kill('SIGTERM');
  process.exitCode = code;
}

feed.on('exit', (code, signal) => {
  if (!closing && (code || signal)) stop(code || 1);
});
feed.on('error', (error) => {
  if (!closing) {
    console.error(`Could not start the diff watcher: ${error.message}`);
    stop(1);
  }
});
site.on('exit', (code, signal) => {
  if (!closing) stop(code || (signal ? 1 : 0));
});
site.on('error', (error) => {
  if (!closing) {
    console.error(`Could not start the local page: ${error.message}`);
    stop(1);
  }
});
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
