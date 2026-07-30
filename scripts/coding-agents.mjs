import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
} from 'node:path';

export const codingAgents = [
  'codex',
  'claude',
  'copilot',
  'cursor',
  'opencode',
];

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
  if (agent === 'cursor') return env.CURSOR_BIN || 'cursor-agent';
  return env[`${agent.toUpperCase()}_BIN`] || agent;
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
    const parts = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return undefined;
        }
      })
      .filter((event) => event?.type === 'text' && event.part?.text)
      .map((event) => event.part.text);
    if (parts.length) return parseJsonText(parts.join(''), 'OpenCode');
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

  const args = [
    'run',
    '--pure',
    '--format',
    'json',
    '--dir',
    workingDirectory,
    '--file',
    inputPath,
  ];
  if (model) args.push('--model', model);
  if (reasoning) args.push('--variant', reasoning);
  args.push(
    `${prompt}\n\nThe attached JSON file is the snapshot. Return JSON that matches this schema:\n${JSON.stringify(schema)}`,
  );
  return { command: binary, args, input: 'none' };
}
