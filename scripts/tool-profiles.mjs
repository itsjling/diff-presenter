import { spawn } from 'node:child_process';

const developerProfile = {
  name: 'developer',
  noToolFallback: 'summary',
  mcpServers: {
    openaiDeveloperDocs: {
      tools: ['search_openai_docs', 'fetch_openai_doc'],
      approvalMode: 'auto',
    },
  },
  plugins: {
    'github@openai-curated-remote': {
      tools: ['get_issue', 'list_issues'],
      approvalMode: 'prompt',
    },
  },
};

const summaryProfile = {
  name: 'summary',
  noToolFallback: true,
  mcpServers: {},
  plugins: {},
};

export const toolProfiles = {
  developer: developerProfile,
  summary: summaryProfile,
};

function integrationFor(profile, server) {
  return profile.mcpServers?.[server] || profile.plugins?.[server];
}

function integrationDecision(integration, server, tool, enabled) {
  if (!enabled.includes(server)) {
    return { state: 'denied', reason: 'integration is not enabled' };
  }
  if (!integration.tools.includes(tool)) {
    return { state: 'denied', reason: 'tool is not allowed' };
  }
  return {
    state: integration.approvalMode === 'prompt' ? 'prompt' : 'allowed',
  };
}

export function toolDecision({ profile, server, tool, enabled = [] }) {
  const integration = integrationFor(profile, server);
  if (!integration) return { state: 'denied', reason: 'unknown integration' };
  return integrationDecision(integration, server, tool, enabled);
}

function timeoutAfter(milliseconds) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('tool timed out')), milliseconds);
  });
}

function recordResult(results, result) {
  results.push(result);
  return result;
}

// fallow-ignore-next-line complexity -- the result mirrors the three policy states.
async function blockedResult(decision, requestPermission, record) {
  if (decision.state === 'denied') {
    return { ...record, status: 'denied', reason: decision.reason };
  }
  if (decision.state !== 'prompt') return undefined;
  const approved = await requestPermission?.(record);
  return approved ? undefined : { ...record, status: 'prompt-denied' };
}

async function callResult(call, request, record, timeoutMs) {
  try {
    const value = await Promise.race([
      call(request),
      timeoutAfter(timeoutMs),
    ]);
    return { ...record, status: 'success', result: value };
  } catch (error) {
    return {
      ...record,
      status: error.message === 'tool timed out' ? 'timeout' : 'error',
      error: error.message,
    };
  }
}

export function createToolRunner({
  profile,
  enabled,
  call,
  requestPermission,
  timeoutMs = 1_000,
}) {
  const results = [];

  async function run({ server, tool, arguments: input = {} }) {
    const decision = toolDecision({ profile, server, tool, enabled });
    const record = { server, tool };
    const blocked = await blockedResult(decision, requestPermission, record);
    if (blocked) return recordResult(results, blocked);
    const request = { server, tool, arguments: input };
    return recordResult(
      results,
      await callResult(call, request, record, timeoutMs),
    );
  }

  return { results, run };
}

function settleMessage(pending, line) {
  if (!line) return;
  const message = JSON.parse(line);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) {
    request.reject(new Error(message.error.message));
    return;
  }
  request.resolve(message.result);
}

export function createStdioMcpTransport({
  command,
  args = [],
  env = process.env,
}) {
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let nextId = 1;
  let buffered = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines) settleMessage(pending, line);
  });
  child.once('error', (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });

  return {
    call({ tool, arguments: input }) {
      return new Promise((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { resolve, reject });
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: { name: tool, arguments: input },
          })}\n`,
        );
      });
    },
    close() {
      child.kill('SIGTERM');
    },
  };
}
