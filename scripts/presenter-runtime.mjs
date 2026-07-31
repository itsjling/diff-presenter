import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function agentRunNeeded(
  fingerprint,
  { activeFingerprint, completedFingerprint, failedFingerprint } = {},
) {
  return Boolean(
    fingerprint &&
      fingerprint !== activeFingerprint &&
      fingerprint !== completedFingerprint &&
      fingerprint !== failedFingerprint,
  );
}

export function agentRunCompleted({ code, error, signal, superseded }) {
  return !error && !code && !signal && !superseded;
}

export function failedAgentRunForFingerprint(
  failedFingerprint,
  observedFingerprint,
) {
  if (!failedFingerprint || !observedFingerprint) return failedFingerprint;
  return failedFingerprint === observedFingerprint
    ? failedFingerprint
    : undefined;
}

export function browserCommand({ url, browser, platform = process.platform }) {
  if (browser) return { command: browser, args: [url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] };
  }
  return { command: 'xdg-open', args: [url] };
}

export function openBrowser(
  url,
  {
    browser = process.env.BROWSER,
    platform = process.platform,
    spawnProcess = spawn,
    onError = () => {},
  } = {},
) {
  try {
    const { command, args } = browserCommand({ url, browser, platform });
    const opener = spawnProcess(command, args, { detached: true, stdio: 'ignore' });
    opener.once('error', onError);
    opener.unref();
    return opener;
  } catch (error) {
    onError(error);
    return undefined;
  }
}

function builtAssetsReady({ root, exists = existsSync }) {
  const dist = join(root, 'dist');
  return exists(join(dist, 'index.html')) && exists(join(dist, 'assets'));
}

function npmCommand(platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

function buildAssets(runtime) {
  const result = runtime.run(npmCommand(runtime.platform), ['run', 'build'], {
    cwd: runtime.root,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`Could not build the local page: ${result.error.message}`);
  }
  if (result.status === 0) return;
  const status = Number.isInteger(result.status) ? Number(result.status) : 1;
  const error = new Error(
    `Could not build the local page: npm run build exited with ${status}.`,
  );
  error.exitCode = status;
  throw error;
}

export function ensureBuiltAssets(options) {
  const runtime = {
    exists: existsSync,
    run: spawnSync,
    platform: process.platform,
    ...options,
  };
  if (builtAssetsReady({ root: runtime.root, exists: runtime.exists })) return false;

  buildAssets(runtime);
  if (!builtAssetsReady({ root: runtime.root, exists: runtime.exists })) {
    throw new Error('Could not build the local page: built assets are still missing.');
  }
  return true;
}
