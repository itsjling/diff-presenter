#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { helpText, parseCliArgs } from './cli-args.mjs';
import {
  codingAgentBinary,
  commandAvailable,
  selectCodingAgent,
} from './coding-agents.mjs';
import { doctorReport } from './doctor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const callerDirectory = process.cwd();
let cli;
try {
  cli = parseCliArgs(process.argv.slice(2), { callerDirectory });
} catch (error) {
  console.error(error.message);
  console.error('Run diffsplain --help for usage.');
  process.exit(2);
}

if (cli.help) {
  console.log(helpText);
  process.exit(0);
}
if (cli.version) {
  const packageJson = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  );
  console.log(`diffsplain ${packageJson.version}`);
  process.exit(0);
}
if (cli.doctor) {
  if (cli.doctor.deep) {
    console.error(
      'Warning: deep checks run local provider commands. They do not send a provider prompt.',
    );
  }
  const report = await doctorReport({ deep: cli.doctor.deep });
  console.log(cli.doctor.json ? JSON.stringify(report.json, null, 2) : report.text);
  process.exit(report.ready ? 0 : 1);
}

const { agentEnabled, browserEnabled, host, port } = cli;
const feedArgs = [...cli.feedArgs];
const agentArgs = [...cli.agentArgs];
if (agentEnabled) {
  try {
    const selectedAgent = await selectCodingAgent(
      cli.agent,
      (agent) =>
        commandAvailable(
          codingAgentBinary(agent, { codexBin: cli.codexBin }),
        ),
    );
    agentArgs.push('--agent', selectedAgent);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
const outputIndex = feedArgs.indexOf('--output');
let runtimeDirectory;

if (outputIndex === -1) {
  runtimeDirectory = mkdtempSync(join(tmpdir(), 'diffsplain-live-'));
  const liveOutput = resolve(runtimeDirectory, 'diff-data.json');
  feedArgs.push('--output', liveOutput);
  agentArgs.push('--output', liveOutput);
}
process.on('exit', () => {
  if (runtimeDirectory) {
    rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});
if (!feedArgs.includes('--watch')) feedArgs.push('--watch');
const outputPath = resolve(
  callerDirectory,
  feedArgs[feedArgs.indexOf('--output') + 1],
);
const repoIndex = feedArgs.indexOf('--repo');
const remoteIndex = feedArgs.indexOf('--remote');
const projectKey = createHash('sha256')
  .update(
    remoteIndex === -1
      ? feedArgs[repoIndex + 1]
      : `${feedArgs[repoIndex + 1]}\0${feedArgs[remoteIndex + 1]}`,
  )
  .digest('hex')
  .slice(0, 12);
if (agentEnabled) {
  feedArgs.push('--ignore-summary-watch');
  agentArgs.push('--snapshot', outputPath);
}

const builtPage = resolve(root, 'dist/index.html');
if (!existsSync(builtPage)) {
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'build'],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) {
    console.error(`Could not build the local page: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

const feed = spawn(
  process.execPath,
  [resolve(root, 'scripts/build-diff-data.mjs'), ...feedArgs],
  {
    cwd: callerDirectory,
    stdio: ['inherit', 'pipe', 'inherit'],
  },
);
let closing = false;
let site;
let agent;
let agentTimer;
let agentFingerprint;
let queuedFingerprint;
let browserOpened = false;
let browserOpenTimer;

function openBrowser(url) {
  let command;
  let args;
  if (process.env.BROWSER) {
    command = process.env.BROWSER;
    args = [url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/d', '/s', '/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  const opener = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  opener.once('error', (error) => {
    console.error(`Could not open the browser: ${error.message}`);
  });
  opener.unref();
}

function startSite() {
  if (closing || site) return;
  const child = spawn(
    process.execPath,
    [
      resolve(root, 'scripts/serve-built.mjs'),
      '--output',
      outputPath,
      '--port',
      String(port),
      '--host',
      host,
      '--project',
      projectKey,
      ...(!cli.portWasPassed ? ['--increment-port'] : []),
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  site = child;

  if (child.stdout) {
    const siteLines = createInterface({ input: child.stdout });
    siteLines.on('line', (line) => {
      if (line === 'Diffsplain tab: connected') {
        if (!browserOpened && browserOpenTimer) {
          clearTimeout(browserOpenTimer);
          browserOpenTimer = undefined;
          browserOpened = true;
          console.log('Reusing the open Diffsplain tab.');
        }
        return;
      }
      console.log(line);
      const match = line.match(/^Diffsplain: (http:\/\/\S+)$/);
      if (browserEnabled && !browserOpened && !browserOpenTimer && match) {
        browserOpenTimer = setTimeout(() => {
          browserOpenTimer = undefined;
          browserOpened = true;
          openBrowser(match[1]);
        }, 750);
      }
    });
  }

  child.on('exit', (code, signal) => {
    if (!closing) stop(code || (signal ? 1 : 0));
  });
  child.on('error', (error) => {
    if (!closing) {
      console.error(`Could not start the local page: ${error.message}`);
      stop(1);
    }
  });
}

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
    if (fingerprint !== agentFingerprint) {
      queuedFingerprint = fingerprint;
      agent.kill('SIGTERM');
    }
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
    !cli.forceSummaryRegeneration &&
    !agentFingerprint &&
    state?.hasCurrentAgentNotes &&
    selectedFingerprint === state.fingerprint
  ) {
    agentFingerprint = selectedFingerprint;
    return;
  }
  if (!selectedFingerprint || selectedFingerprint === agentFingerprint) return;
  if (agent) {
    if (selectedFingerprint !== agentFingerprint) {
      queuedFingerprint = selectedFingerprint;
      agent.kill('SIGTERM');
    }
    return;
  }
  clearTimeout(agentTimer);
  const delay = agentFingerprint ? 300 : 0;
  agentTimer = setTimeout(() => runAgent(selectedFingerprint), delay);
}

if (feed.stdout) {
  const feedLines = createInterface({ input: feed.stdout });
  feedLines.on('line', (line) => {
    const snapshotReady =
      line.startsWith('Wrote ') || line === 'No diff-data changes';
    if (snapshotReady) {
      startSite();
      if (agentEnabled) scheduleAgent();
    }
    if (line !== 'No diff-data changes' || !agentEnabled) console.log(line);
  });
}

function stop(code = 0) {
  if (closing) return;
  closing = true;
  clearTimeout(browserOpenTimer);
  clearTimeout(agentTimer);
  if (!feed.killed) feed.kill('SIGTERM');
  if (site && !site.killed) site.kill('SIGTERM');
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
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
