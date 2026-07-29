import { spawnSync } from 'node:child_process';
import {
  codingAgentBinary,
  codingAgents,
  findCommand,
} from './coding-agents.mjs';

const agentLabels = {
  codex: 'Codex',
  claude: 'Claude',
  copilot: 'Copilot',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

function firstLine(value) {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
}

function commandVersion(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return undefined;
  return firstLine(`${result.stdout || ''}\n${result.stderr || ''}`);
}

async function inspectDependency(
  label,
  command,
  {
    env,
    platform,
  },
) {
  const path = await findCommand(command, { env, platform });
  if (!path) return { label, command, installed: false };
  return {
    label,
    command,
    installed: true,
    path,
    version: commandVersion(path),
  };
}

function dependencyLine(dependency) {
  const label = dependency.label.padEnd(9);
  if (!dependency.installed) {
    return `  ✗ ${label} not found (${dependency.command})`;
  }
  const mark = dependency.version ? '✓' : '!';
  const version = dependency.version || 'version unavailable';
  return `  ${mark} ${label} ${version} (${dependency.path})`;
}

function joinedAgentNames(agents) {
  return agents.map((agent) => agent.label).join(', ');
}

export async function doctorReport({
  env = process.env,
  platform = process.platform,
  architecture = process.arch,
  nodeVersion = process.version,
  nodePath = process.execPath,
} = {}) {
  const [git, gh, ...agents] = await Promise.all([
    inspectDependency('Git', 'git', { env, platform }),
    inspectDependency('gh', 'gh', { env, platform }),
    ...codingAgents.map((agent) =>
      inspectDependency(
        agentLabels[agent],
        codingAgentBinary(agent, { env }),
        { env, platform },
      ),
    ),
  ]);
  const installedAgents = agents.filter((agent) => agent.installed);
  const agentCount = installedAgents.length
    ? `${installedAgents.length} installed`
    : 'none installed';
  const lines = [
    'Diffsplain doctor',
    '',
    'Dependencies',
    `  ✓ ${'Node'.padEnd(9)} ${nodeVersion} (${nodePath})`,
    dependencyLine(git),
    dependencyLine(gh),
    '',
    `Coding agents (${agentCount})`,
    ...agents.map(dependencyLine),
    '',
    'Status',
    git.installed
      ? '  ✓ Git reviews are ready.'
      : '  ✗ Git is not installed.',
    installedAgents.length
      ? `  ✓ Agent notes are ready with ${joinedAgentNames(installedAgents)}.`
      : '  ✗ No supported coding agent is installed.',
    gh.installed
      ? '  ✓ Pull request lookup is ready with gh.'
      : '  ✗ gh is not installed; pull request lookup is unavailable.',
    `  Platform: ${platform} ${architecture}`,
  ];
  if (!installedAgents.length) {
    lines.push('  Use --no-agent to run without agent notes.');
  }
  return {
    text: lines.join('\n'),
    ready: git.installed && installedAgents.length > 0,
  };
}
