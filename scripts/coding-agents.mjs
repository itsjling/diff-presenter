import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import {
  basename,
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

export async function findCommand(
  command,
  {
    env = process.env,
    platform = process.platform,
  } = {},
) {
  if (
    isAbsolute(command) ||
    command.includes('/') ||
    command.includes('\\')
  ) {
    return (await executable(command)) ? command : undefined;
  }

  const extensions =
    platform === 'win32'
      ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
      : [''];
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

export async function commandAvailable(command, options) {
  return Boolean(await findCommand(command, options));
}

export async function selectCodingAgent(
  requested,
  available = commandAvailable,
) {
  if (requested) {
    if (!codingAgents.includes(requested)) {
      throw new Error(
        `Unsupported agent "${requested}". Choose ${codingAgents.join(', ')}.`,
      );
    }
    if (!(await available(requested))) {
      throw new Error(`Coding agent "${requested}" is not available.`);
    }
    return requested;
  }

  for (const agent of codingAgents) {
    if (await available(agent)) return agent;
  }
  throw new Error(
    `No coding agent is available. Install one of: ${codingAgents.join(', ')}.`,
  );
}

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

export function parseAgentResponse(agent, stdout) {
  if (agent === 'claude') {
    const envelope = parseJsonText(stdout, 'Claude');
    if (envelope?.structured_output) return envelope.structured_output;
    if (typeof envelope?.result === 'string') {
      return parseJsonText(envelope.result, 'Claude');
    }
    return envelope;
  }

  if (agent === 'opencode') {
    const events = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return undefined;
        }
      });
    const parts = events
      .filter((event) => event?.type === 'text' && event.part?.text)
      .map((event) => event.part.text);
    if (parts.length) return parseJsonText(parts.join(''), 'OpenCode');
    throw new Error('OpenCode did not return summary JSON');
  }

  if (agent === 'cursor') {
    const envelope = parseJsonText(stdout, 'Cursor');
    if (typeof envelope?.result === 'string') {
      return parseJsonText(envelope.result, 'Cursor');
    }
    return envelope;
  }

  const label = agent === 'copilot' ? 'Copilot' : 'Codex';
  return parseJsonText(stdout, label);
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
  workingDirectory,
  env = process.env,
}) {
  if (agent === 'codex') {
    const args = [
      'exec',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--ignore-user-config',
      '--color',
      'never',
      '--skip-git-repo-check',
      '-C',
      workingDirectory,
      '--output-schema',
      schemaPath,
    ];
    if (model) args.push('--model', model);
    if (reasoning) {
      args.push(
        '--config',
        `model_reasoning_effort=${JSON.stringify(reasoning)}`,
      );
    }
    args.push(prompt);
    return { command: binary, args, input: 'stdin' };
  }

  if (agent === 'claude') {
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
    return { command: binary, args, input: 'stdin' };
  }

  if (agent === 'copilot') {
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
    return { command: binary, args, input: 'none' };
  }

  if (agent === 'cursor') {
    const args = ['--print', '--trust', '--output-format', 'json'];
    if (model) args.push('--model', model);
    args.push(
      `${prompt}\n\nRead the snapshot from @${basename(inputPath)}. Return only JSON that matches this schema:\n${JSON.stringify(schema)}`,
    );
    return {
      command: binary,
      args,
      input: 'none',
      cwd: dirname(inputPath),
    };
  }

  let config = {};
  try {
    const parsed = JSON.parse(env.OPENCODE_CONFIG_CONTENT || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      config = parsed;
    }
  } catch {
    // Replace invalid inline config with the safe settings for this run.
  }
  const configuredAgents =
    config.agent &&
    typeof config.agent === 'object' &&
    !Array.isArray(config.agent)
      ? config.agent
      : {};
  const configuredBuild =
    configuredAgents.build &&
    typeof configuredAgents.build === 'object' &&
    !Array.isArray(configuredAgents.build)
      ? configuredAgents.build
      : {};
  const args = [
    'run',
    '--pure',
    '--format',
    'json',
    '--dir',
    dirname(inputPath),
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
    cwd: dirname(inputPath),
    env: {
      OPENCODE_DB: ':memory:',
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        ...config,
        permission: { '*': 'deny' },
        agent: {
          ...configuredAgents,
          build: {
            ...configuredBuild,
            permission: { '*': 'deny' },
          },
        },
      }),
    },
  };
}
