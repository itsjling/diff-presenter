import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
} from 'node:path';

export const codingAgentCapabilities = {
  codex: { binary: 'codex', model: true, reasoning: true },
  claude: { binary: 'claude', model: true, reasoning: false },
  copilot: { binary: 'copilot', model: true, reasoning: false },
  cursor: { binary: 'cursor-agent', model: true, reasoning: false },
  opencode: { binary: 'opencode', model: true, reasoning: true },
};

export const codingAgents = Object.keys(codingAgentCapabilities);

export function agentSupportsReasoning(agent) {
  return codingAgentCapabilities[agent]?.reasoning === true;
}

export function assertReasoningSupported(agent, reasoning) {
  if (reasoning && !agentSupportsReasoning(agent)) {
    throw new Error(
      `--reasoning is supported only by codex and opencode; ${agent} does not support it.`,
    );
  }
}

const summaryEnvironmentNames = [
  'CODEX_HOME',
  'COMSPEC',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LANG',
  'LC_ALL',
  'NODE_EXTRA_CA_CERTS',
  'NO_PROXY',
  'PATH',
  'SSL_CERT_FILE',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
];

export function summaryAgentEnvironment(env = process.env) {
  return Object.fromEntries(
    summaryEnvironmentNames
      .filter((name) => typeof env[name] === 'string')
      .map((name) => [name, env[name]]),
  );
}

const cursorDisabledReason =
  'Cursor review is disabled: Cursor Agent has no supported read-only, no-network, no-tool mode.';

export function agentDisabledReason(agent) {
  if (agent === 'cursor') return cursorDisabledReason;
  return undefined;
}

export const enabledCodingAgents = codingAgents.filter(
  (agent) => !agentDisabledReason(agent),
);

async function executable(path) {
  try {
    await access(
      path,
      process.platform === 'win32' ? constants.F_OK : constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function commandExtensions(platform, env) {
  return platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
}

async function findOnPath(command, env, platform) {
  const extensions =
    commandExtensions(platform, env);
  const directories = (env.PATH || '').split(delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const extension of extensions) {
      if (await executable(join(directory, `${command}${extension}`))) {
        return join(directory, `${command}${extension}`);
      }
    }
  }
  return undefined;
}

export async function findCommand(
  command,
  {
    env = process.env,
    platform = process.platform,
  } = {},
) {
  const direct =
    isAbsolute(command) ||
    command.includes('/') ||
    command.includes('\\');
  if (direct) return (await executable(command)) ? command : undefined;
  return findOnPath(command, env, platform);
}

export async function commandAvailable(command, options) {
  return Boolean(await findCommand(command, options));
}

// fallow-ignore-next-line complexity -- validation and fallback share one public selector.
export async function selectCodingAgent(
  requested,
  available = commandAvailable,
) {
  if (requested) {
    if (!codingAgents.includes(requested)) {
      throw new Error(
        `Unsupported agent "${requested}". Choose ${enabledCodingAgents.join(', ')}.`,
      );
    }
    const disabled = agentDisabledReason(requested);
    if (disabled) throw new Error(disabled);
    if (!(await available(requested))) {
      throw new Error(`Coding agent "${requested}" is not available.`);
    }
    return requested;
  }

  for (const agent of enabledCodingAgents) {
    if (await available(agent)) return agent;
  }
  throw new Error(
    `No coding agent is available. Install one of: ${enabledCodingAgents.join(', ')}. ${cursorDisabledReason}`,
  );
}

// fallow-ignore-next-line complexity -- each supported agent has one override rule.
export function codingAgentBinary(
  agent,
  {
    codexBin,
    env = process.env,
  } = {},
) {
  if (agent === 'codex') return codexBin || env.CODEX_BIN || agent;
  if (agent === 'cursor') {
    return env.CURSOR_BIN || codingAgentCapabilities.cursor.binary;
  }
  return (
    env[`${agent.toUpperCase()}_BIN`] ||
    codingAgentCapabilities[agent]?.binary ||
    agent
  );
}

function parseJsonText(text, agent) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try {
    return JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    throw new Error(`${agent} did not return valid summary JSON`);
  }
}

function parseClaudeResponse(stdout) {
  const envelope = parseJsonText(stdout, 'Claude');
  if (envelope?.structured_output) return envelope.structured_output;
  if (typeof envelope?.result === 'string') {
    return parseJsonText(envelope.result, 'Claude');
  }
  return envelope;
}

function parseEvent(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function parseOpenCodeResponse(stdout) {
  const parts = stdout
    .split('\n')
    .filter(Boolean)
    .map(parseEvent)
    .filter((event) => event?.type === 'text' && event.part?.text)
    .map((event) => event.part.text);
  if (!parts.length) throw new Error('OpenCode did not return summary JSON');
  return parseJsonText(parts.join(''), 'OpenCode');
}

function parseCursorResponse(stdout) {
  const envelope = parseJsonText(stdout, 'Cursor');
  if (typeof envelope?.result === 'string') {
    return parseJsonText(envelope.result, 'Cursor');
  }
  return envelope;
}

export function parseAgentResponse(agent, stdout) {
  if (agent === 'claude') return parseClaudeResponse(stdout);
  if (agent === 'opencode') return parseOpenCodeResponse(stdout);
  if (agent === 'cursor') return parseCursorResponse(stdout);
  const label = agent === 'copilot' ? 'Copilot' : 'Codex';
  return parseJsonText(stdout, label);
}

function codexCommand({
  binary,
  model,
  reasoning,
  prompt,
  schemaPath,
  summaryDirectory,
  summaryEnv,
}) {
  const args = [
    'exec',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--ignore-user-config',
    '--ignore-rules',
    '--color',
    'never',
    '--skip-git-repo-check',
    '-C',
    summaryDirectory,
    '--output-schema',
    schemaPath,
    '--config',
    'mcp_servers={}',
    '--config',
    'plugins={}',
    '--config',
    'shell_environment_policy.inherit="none"',
    '--config',
    'sandbox_workspace_write.network_access=false',
    '--config',
    'web_search="disabled"',
  ];
  if (model) args.push('--model', model);
  if (reasoning) {
    args.push(
      '--config',
      `model_reasoning_effort=${JSON.stringify(reasoning)}`,
    );
  }
  args.push(prompt);
  return {
    command: binary,
    args,
    input: 'stdin',
    cwd: summaryDirectory,
    env: summaryEnv,
  };
}

function claudeCommand({
  binary,
  model,
  prompt,
  schema,
  summaryDirectory,
  summaryEnv,
}) {
  const args = [
    '--print',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(schema),
    '--tools',
    '',
    '--no-session-persistence',
  ];
  if (model) args.push('--model', model);
  args.push(prompt);
  return {
    command: binary,
    args,
    input: 'stdin',
    cwd: summaryDirectory,
    env: summaryEnv,
  };
}

function copilotCommand({
  binary,
  inputPath,
  model,
  prompt,
  schema,
  summaryDirectory,
  summaryEnv,
}) {
  const schemaText = JSON.stringify(schema);
  const args = [
    '--silent',
    '--no-ask-user',
    '--no-color',
    '--no-custom-instructions',
    '--no-remote',
    '--no-remote-export',
    `--add-dir=${dirname(inputPath)}`,
  ];
  if (model) args.push('--model', model);
  args.push(
    '--prompt',
    `${prompt}\n\nRead the snapshot from @${inputPath}. Return JSON that matches this schema:\n${schemaText}`,
  );
  return {
    command: binary,
    args,
    input: 'none',
    cwd: summaryDirectory,
    env: summaryEnv,
  };
}

function openCodeCommand({
  binary,
  model,
  reasoning,
  prompt,
  schema,
  summaryDirectory,
  summaryEnv,
}) {
  const args = [
    'run',
    '--pure',
    '--format',
    'json',
    '--dir',
    summaryDirectory,
    '--agent',
    'build',
  ];
  if (model) args.push('--model', model);
  if (reasoning) args.push('--variant', reasoning);
  args.push(
    `${prompt}\n\nThe snapshot JSON follows this prompt on standard input. Return JSON that matches this schema:\n${JSON.stringify(schema)}`,
  );
  return {
    command: binary,
    args,
    input: 'stdin',
    cwd: summaryDirectory,
    env: {
      ...summaryEnv,
      OPENCODE_DB: ':memory:',
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        permission: { '*': 'deny' },
        agent: {
          build: {
            permission: { '*': 'deny' },
          },
        },
      }),
    },
  };
}

export function agentCommand({
  agent,
  binary = agent,
  model,
  reasoning,
  prompt,
  schema,
  schemaPath,
  inputPath,
  env = process.env,
}) {
  const disabled = agentDisabledReason(agent);
  if (disabled) throw new Error(disabled);
  const options = {
    binary,
    inputPath,
    model,
    prompt,
    reasoning,
    schema,
    schemaPath,
    summaryDirectory: dirname(inputPath),
    summaryEnv: summaryAgentEnvironment(env),
  };
  if (agent === 'codex') return codexCommand(options);
  if (agent === 'claude') return claudeCommand(options);
  if (agent === 'copilot') return copilotCommand(options);
  return openCodeCommand(options);
}
