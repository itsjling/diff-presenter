import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createStdioMcpTransport,
  createToolRunner,
  toolDecision,
  toolProfiles,
} from '../scripts/tool-profiles.mjs';

const root = new URL('..', import.meta.url).pathname;

async function fakeMcp(rootDirectory) {
  const server = join(rootDirectory, 'fake-mcp.mjs');
  await writeFile(
    server,
    `#!/usr/bin/env node
import { createInterface } from 'node:readline';
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  const request = JSON.parse(line);
  const name = request.params.name;
  if (name === 'error') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { message: 'server failed' } }) + '\\n');
    return;
  }
  if (name === 'slow') {
    setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { value: 'late' } }) + '\\n'), 100);
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { value: name } }) + '\\n');
});
`,
  );
  await chmod(server, 0o755);
  return server;
}

test('names opt-in developer integrations and a no-tool summary fallback', () => {
  assert.deepEqual(toolProfiles.developer.noToolFallback, 'summary');
  assert.deepEqual(toolProfiles.summary.noToolFallback, true);
  assert.deepEqual(
    toolProfiles.developer.mcpServers.openaiDeveloperDocs.tools,
    ['search_openai_docs', 'fetch_openai_doc'],
  );
  assert.deepEqual(
    toolProfiles.developer.plugins['github@openai-curated-remote'].tools,
    ['get_issue', 'list_issues'],
  );
  assert.equal(
    toolDecision({
      profile: toolProfiles.summary,
      enabled: ['openaiDeveloperDocs'],
      server: 'openaiDeveloperDocs',
      tool: 'search_openai_docs',
    }).state,
    'denied',
  );
  assert.equal(
    toolDecision({
      profile: toolProfiles.developer,
      enabled: [],
      server: 'openaiDeveloperDocs',
      tool: 'search_openai_docs',
    }).state,
    'denied',
  );
});

test('records fake MCP allowed, denied, error, timeout, and prompt outcomes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-mcp-'));
  let transport;

  try {
    const server = await fakeMcp(directory);
    transport = createStdioMcpTransport({
      command: process.execPath,
      args: [server],
    });
    const profile = {
      name: 'test-developer',
      mcpServers: {
        fake: { tools: ['read', 'error', 'slow'], approvalMode: 'auto' },
        prompted: { tools: ['prompt'], approvalMode: 'prompt' },
      },
      plugins: {},
    };
    const runner = createToolRunner({
      profile,
      enabled: ['fake', 'prompted'],
      call: transport.call,
      timeoutMs: 500,
      requestPermission: ({ server: name }) => name === 'prompted',
    });

    assert.deepEqual(await runner.run({ server: 'fake', tool: 'read' }), {
      server: 'fake',
      tool: 'read',
      status: 'success',
      result: { value: 'read' },
    });
    assert.deepEqual(await runner.run({ server: 'fake', tool: 'write' }), {
      server: 'fake',
      tool: 'write',
      status: 'denied',
      reason: 'tool is not allowed',
    });
    assert.deepEqual(await runner.run({ server: 'fake', tool: 'error' }), {
      server: 'fake',
      tool: 'error',
      status: 'error',
      error: 'server failed',
    });
    const slowRunner = createToolRunner({
      profile,
      enabled: ['fake'],
      call: transport.call,
      timeoutMs: 20,
    });
    assert.deepEqual(await slowRunner.run({ server: 'fake', tool: 'slow' }), {
      server: 'fake',
      tool: 'slow',
      status: 'timeout',
      error: 'tool timed out',
    });
    assert.deepEqual(await runner.run({ server: 'prompted', tool: 'prompt' }), {
      server: 'prompted',
      tool: 'prompt',
      status: 'success',
      result: { value: 'prompt' },
    });
    assert.deepEqual(runner.results.map((result) => result.status), [
      'success',
      'denied',
      'error',
      'success',
    ]);
    assert.deepEqual(slowRunner.results.map((result) => result.status), [
      'timeout',
    ]);

    const deniedPrompt = createToolRunner({
      profile,
      enabled: ['prompted'],
      call: transport.call,
      requestPermission: () => false,
    });
    assert.deepEqual(
      await deniedPrompt.run({ server: 'prompted', tool: 'prompt' }),
      { server: 'prompted', tool: 'prompt', status: 'prompt-denied' },
    );
  } finally {
    transport?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('profile templates have no secrets or machine paths', async () => {
  const files = [
    '.codex/config.toml',
    '.codex/developer.config.toml.example',
    '.codex/summary.config.toml.example',
  ];
  for (const file of files) {
    const content = await readFile(join(root, file), 'utf8');
    assert.doesNotMatch(content, /(?:token|secret|password|api[_-]?key)\s*=/i);
    assert.doesNotMatch(content, /(?:^|[=\s])\/(?:Users|home)\//m);
  }
  const summary = await readFile(
    join(root, '.codex/summary.config.toml.example'),
    'utf8',
  );
  assert.doesNotMatch(summary, /agents\.enabled|^\[agents\]$/m);
});

test('uses valid app policy fields and runtime integration resets', async () => {
  const [developer, summary, development] = await Promise.all([
    readFile(join(root, '.codex/developer.config.toml.example'), 'utf8'),
    readFile(join(root, '.codex/summary.config.toml.example'), 'utf8'),
    readFile(join(root, 'docs/content/development.mdx'), 'utf8'),
  ]);
  const pluginSection = developer.match(
    /\[plugins\."github@openai-curated-remote"\]([\s\S]*?)(?=\n\[|$)/,
  )?.[1];

  assert.match(pluginSection, /enabled = true/);
  assert.doesNotMatch(
    pluginSection,
    /default_tools_approval_mode|destructive_enabled|open_world_enabled/,
  );
  assert.match(developer, /\[apps\.github\]/);
  assert.match(developer, /default_tools_approval_mode = "prompt"/);
  assert.match(developer, /destructive_enabled = false/);
  assert.match(developer, /open_world_enabled = false/);
  assert.doesNotMatch(summary, /^\[(?:mcp_servers|plugins)\]$/m);
  assert.match(development, /--ignore-user-config/);
  assert.match(development, /mcp_servers=\{\}/);
  assert.match(development, /plugins=\{\}/);
});
