import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { codingAgents } from './coding-agents.mjs';

const valueOptions = new Set([
  '--repo',
  '--branch',
  '--pr',
  '--base',
  '--head',
  '--remote',
  '--summaries',
  '--output',
  '--cache-dir',
  '--codex-bin',
  '--model',
  '--reasoning',
  '--batch-size',
  '--jobs',
  '--port',
]);
const flagOptions = new Set([
  '--help',
  '--version',
  '--agent',
  '--no-agent',
  '--force',
  '--worktree',
]);
const pathOptions = new Set([
  '--summaries',
  '--output',
  '--cache-dir',
  '--codex-bin',
]);

export const helpText = `Usage: diffsplain [REPO] [options]

Show the current checkout against its default branch:
  diffsplain

Commands:
  doctor              Check Git, GitHub CLI, and coding agents

Targets:
  --branch NAME       Show a remote branch against its default branch
  --pr NUMBER|URL     Show a GitHub pull request
  --worktree          Show only worktree changes against HEAD
  --base REF --head REF
                      Show an exact local Git range

Options:
  --repo PATH|URL|OWNER/NAME
                      Repo to review (default: current repo)
  --agent NAME        Use codex, claude, copilot, cursor, or opencode
  --no-agent          Do not write agent notes
  --model NAME        Model for agent notes
  --reasoning LEVEL   Agent reasoning effort when supported
  --batch-size COUNT  Maximum files per agent pass (default: 12)
  --jobs COUNT        Agent passes to run at once (default: 3; OpenCode: 1)
  --force             Regenerate all agent notes
  --remote NAME|URL   Git remote (default: origin)
  --port NUMBER       Local page port (default: 2299)
  -h, --help          Show this help
  -v, --version       Show the installed version

Agent fallback:
  codex, claude, copilot, cursor, opencode

Examples:
  diffsplain
  diffsplain doctor
  diffsplain --repo owner/project --pr 42
  diffsplain owner/project --branch feature/search
  diffsplain --agent claude`;

function fail(message) {
  throw new Error(message);
}

function splitOption(argument) {
  if (argument === '-h') return { name: '--help', value: undefined };
  if (argument === '-v') return { name: '--version', value: undefined };
  if (!argument.startsWith('--')) return undefined;
  const separator = argument.indexOf('=');
  if (separator === -1) return { name: argument, value: undefined };
  return {
    name: argument.slice(0, separator),
    value: argument.slice(separator + 1),
  };
}

function githubRepoFromPullRequest(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/\d+(?:\/|$)/);
    if (!match) return undefined;
    return `${url.origin}/${match[1]}/${match[2].replace(/\.git$/, '')}.git`;
  } catch {
    return undefined;
  }
}

function remoteRepo(value, callerDirectory, pathExists) {
  if (pathExists(resolve(callerDirectory, value))) return undefined;
  if (
    /^(?:https?|ssh|git|file):\/\//i.test(value) ||
    /^(?:[^@/\s]+@)?[^:/\s]+:.+/.test(value)
  ) {
    return value;
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(value)) {
    return `https://github.com/${value.replace(/\.git$/, '')}.git`;
  }
  return undefined;
}

export function parseCliArgs(
  rawArgs,
  {
    callerDirectory = process.cwd(),
    pathExists = existsSync,
  } = {},
) {
  if (rawArgs[0] === 'doctor') {
    if (rawArgs.length > 1) fail('doctor does not take arguments or options');
    return { doctor: true };
  }

  const options = new Map();
  const positionals = [];
  let agent;
  let agentSet = false;
  let noAgent = false;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    const parsed = splitOption(argument);
    if (!parsed) {
      positionals.push(argument);
      continue;
    }

    if (parsed.name === '--agent') {
      agentSet = true;
      if (parsed.value !== undefined) {
        if (!parsed.value) fail('--agent needs a value');
        agent = parsed.value;
      } else {
        const next = rawArgs[index + 1];
        if (next && !next.startsWith('-')) {
          agent = next;
          index += 1;
        }
      }
      continue;
    }

    if (parsed.name === '--no-agent') {
      if (parsed.value !== undefined) fail('--no-agent does not take a value');
      noAgent = true;
      continue;
    }

    if (flagOptions.has(parsed.name)) {
      if (parsed.value !== undefined) {
        fail(`${parsed.name} does not take a value`);
      }
      options.set(parsed.name, true);
      continue;
    }

    if (!valueOptions.has(parsed.name)) {
      fail(`Unknown option: ${parsed.name}`);
    }
    if (options.has(parsed.name)) fail(`${parsed.name} was passed more than once`);

    let value = parsed.value;
    if (value === undefined) {
      value = rawArgs[index + 1];
      if (!value || value.startsWith('--')) fail(`${parsed.name} needs a value`);
      index += 1;
    }
    if (!value) fail(`${parsed.name} needs a value`);
    options.set(parsed.name, value);
  }

  if (options.has('--help')) return { help: true };
  if (options.has('--version')) return { version: true };
  if (positionals.length > 1) fail('Pass at most one repo');
  if (positionals.length && options.has('--repo')) {
    fail('Pass the repo once, either as REPO or with --repo');
  }
  if (noAgent && agentSet) fail('--agent and --no-agent cannot be used together');
  if (!noAgent && agent && !codingAgents.includes(agent)) {
    fail(
      `Unsupported agent "${agent}". Choose ${codingAgents.join(', ')}.`,
    );
  }

  const branch = options.get('--branch');
  const pullRequest = options.get('--pr');
  const base = options.get('--base');
  const head = options.get('--head');
  const worktree = options.has('--worktree');
  if (branch && pullRequest) fail('--branch and --pr cannot be used together');
  if (pullRequest && (base || head)) {
    fail('--pr cannot be used with --base or --head');
  }
  if (branch && head) fail('--branch cannot be used with --head');
  if (worktree && (branch || pullRequest || base || head)) {
    fail('--worktree cannot be combined with another target');
  }
  if (!branch && !pullRequest && !worktree && Boolean(base) !== Boolean(head)) {
    fail('--base and --head must be used together');
  }

  const repoArgument = positionals[0] || options.get('--repo');
  let remote = options.get('--remote');
  let repo = callerDirectory;
  if (repoArgument) {
    const selectedRemote = remoteRepo(
      repoArgument,
      callerDirectory,
      pathExists,
    );
    if (selectedRemote) {
      if (remote) fail('--repo URL and --remote cannot be used together');
      remote = selectedRemote;
    } else {
      repo = resolve(callerDirectory, repoArgument);
    }
  }

  const pullRequestRemote = pullRequest
    ? githubRepoFromPullRequest(pullRequest)
    : undefined;
  if (pullRequestRemote && !repoArgument && !remote) remote = pullRequestRemote;
  if (repoArgument && remoteRepo(repoArgument, callerDirectory, pathExists)) {
    if (!branch && !pullRequest) {
      fail('A remote repo needs --branch or --pr');
    }
  }

  const commonArgs = ['--repo', repo];
  if (pullRequest) commonArgs.push('--pr', pullRequest);
  if (branch) commonArgs.push('--branch', branch);
  if (worktree) commonArgs.push('--worktree');
  if (!pullRequest && !branch && !worktree && !base && !head) {
    commonArgs.push('--checkout');
  }
  if (base) commonArgs.push('--base', base);
  if (head) commonArgs.push('--head', head);
  if (remote) commonArgs.push('--remote', remote);

  for (const name of ['--summaries', '--output', '--cache-dir']) {
    const value = options.get(name);
    if (value) {
      commonArgs.push(
        name,
        pathOptions.has(name) ? resolve(callerDirectory, value) : value,
      );
    }
  }

  const agentArgs = [...commonArgs];
  if (options.has('--force')) agentArgs.push('--force');
  for (const name of [
    '--codex-bin',
    '--model',
    '--reasoning',
    '--batch-size',
    '--jobs',
  ]) {
    const value = options.get(name);
    if (value) {
      agentArgs.push(
        name,
        pathOptions.has(name) ? resolve(callerDirectory, value) : value,
      );
    }
  }

  const reasoning = options.get('--reasoning');
  if (
    reasoning &&
    !['minimal', 'low', 'medium', 'high', 'xhigh'].includes(
      reasoning,
    )
  ) {
    fail(
      '--reasoning must be minimal, low, medium, high, or xhigh',
    );
  }
  const batchSize = options.get('--batch-size');
  if (
    batchSize &&
    (!/^[1-9]\d*$/.test(batchSize) || Number(batchSize) > 50)
  ) {
    fail('--batch-size must be a number from 1 to 50');
  }
  const jobs = options.get('--jobs');
  if (
    jobs &&
    (!/^[1-9]\d*$/.test(jobs) || Number(jobs) > 8)
  ) {
    fail('--jobs must be a number from 1 to 8');
  }

  const portValue = options.get('--port') || '2299';
  if (!/^\d+$/.test(portValue) || Number(portValue) > 65_535) {
    fail('--port must be a number from 0 to 65535');
  }

  return {
    help: false,
    version: false,
    agentEnabled: !noAgent,
    agent,
    codexBin: options.get('--codex-bin'),
    feedArgs: commonArgs,
    agentArgs,
    port: Number(portValue),
    portWasPassed: options.has('--port'),
    forceSummaryRegeneration: options.has('--force'),
  };
}
