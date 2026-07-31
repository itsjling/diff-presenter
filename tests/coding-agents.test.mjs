import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentDisabledReason,
  agentCommand,
  codingAgentBinary,
  parseAgentResponse,
  selectCodingAgent,
  summaryAgentEnvironment,
} from '../scripts/coding-agents.mjs';

test('selects the first available agent in fallback order', async () => {
  const checked = [];
  const selected = await selectCodingAgent(undefined, async (agent) => {
    checked.push(agent);
    return agent === 'copilot';
  });

  assert.equal(selected, 'copilot');
  assert.deepEqual(checked, ['codex', 'claude', 'copilot']);
});

test('fails when no coding agent is available', async () => {
  const checked = [];
  await assert.rejects(
    selectCodingAgent(undefined, async (agent) => {
      checked.push(agent);
      return false;
    }),
    (error) => {
      assert.match(error.message, /no coding agent is available/i);
      assert.match(error.message, /Cursor review is disabled/i);
      return true;
    },
  );
  assert.deepEqual(checked, ['codex', 'claude', 'copilot', 'opencode']);
});

test('fails when the requested coding agent is unavailable', async () => {
  await assert.rejects(
    selectCodingAgent('claude', async () => false),
    /claude.*not available/i,
  );
});

test('suggests only enabled agents for an unknown name', async () => {
  await assert.rejects(
    selectCodingAgent('gemini'),
    (error) => {
      assert.match(error.message, /Choose codex, claude, copilot, opencode/);
      assert.doesNotMatch(error.message, /Choose .*cursor/);
      return true;
    },
  );
});

test('disables Cursor because it cannot enforce the review boundary', async () => {
  assert.match(
    agentDisabledReason('cursor'),
    /read-only, no-network, no-tool mode/,
  );
  await assert.rejects(
    selectCodingAgent('cursor', async () => true),
    /Cursor review is disabled/,
  );
});

test('builds non-interactive commands for each coding agent', () => {
  const common = {
    binary: '/agent',
    model: 'test-model',
    reasoning: 'low',
    prompt: 'Write JSON.',
    schema: { type: 'object' },
    schemaPath: '/tmp/schema.json',
    inputPath: '/tmp/input.json',
    workingDirectory: '/work',
    env: {},
  };

  const codex = agentCommand({ ...common, agent: 'codex' });
  assert.deepEqual(codex.args.slice(0, 2), ['exec', '--ephemeral']);
  assert.ok(codex.args.includes('--output-schema'));
  assert.ok(codex.args.includes('--skip-git-repo-check'));
  assert.ok(codex.args.includes('--ignore-user-config'));
  assert.ok(codex.args.includes('--ignore-rules'));
  assert.ok(!codex.args.includes('agents.enabled=false'));
  assert.ok(codex.args.includes('mcp_servers={}'));
  assert.ok(codex.args.includes('plugins={}'));
  assert.ok(codex.args.includes('sandbox_workspace_write.network_access=false'));
  assert.ok(codex.args.includes('web_search="disabled"'));
  assert.equal(codex.cwd, '/tmp');
  assert.equal(codex.input, 'stdin');

  const claude = agentCommand({ ...common, agent: 'claude' });
  assert.ok(claude.args.includes('--json-schema'));
  assert.ok(claude.args.includes('--no-session-persistence'));
  assert.equal(claude.cwd, '/tmp');
  assert.equal(claude.input, 'stdin');

  const copilot = agentCommand({ ...common, agent: 'copilot' });
  assert.ok(copilot.args.includes('--silent'));
  assert.ok(copilot.args.includes('--no-ask-user'));
  assert.match(copilot.args.at(-1), /@\/tmp\/input\.json/);
  assert.equal(copilot.cwd, '/tmp');

  assert.throws(
    () => agentCommand({ ...common, agent: 'cursor' }),
    /Cursor review is disabled/,
  );

  const opencode = agentCommand({ ...common, agent: 'opencode' });
  assert.deepEqual(opencode.args.slice(0, 4), [
    'run',
    '--pure',
    '--format',
    'json',
  ]);
  assert.ok(!opencode.args.includes('--file'));
  assert.ok(opencode.args.includes('--variant'));
  assert.deepEqual(
    opencode.args.slice(
      opencode.args.indexOf('--agent'),
      opencode.args.indexOf('--agent') + 2,
    ),
    ['--agent', 'build'],
  );
  assert.deepEqual(
    opencode.args.slice(
      opencode.args.indexOf('--dir'),
      opencode.args.indexOf('--dir') + 2,
    ),
    ['--dir', '/tmp'],
  );
  assert.equal(opencode.cwd, '/tmp');
  assert.equal(opencode.input, 'stdin');
  assert.equal(opencode.env.OPENCODE_DB, ':memory:');
  assert.equal(
    opencode.env.OPENCODE_CONFIG_CONTENT,
    '{"permission":{"*":"deny"},"agent":{"build":{"permission":{"*":"deny"}}}}',
  );
});

test('passes only runtime variables to product summary agents', () => {
  assert.deepEqual(
    summaryAgentEnvironment({
      API_TOKEN: 'do-not-pass',
      HOME: '/home/reviewer',
      HTTPS_PROXY: 'http://proxy.example.test:8080',
      NODE_EXTRA_CA_CERTS: '/etc/company-ca.pem',
      NO_PROXY: 'localhost,127.0.0.1',
      PATH: '/usr/bin',
      SSL_CERT_FILE: '/etc/ssl/cert.pem',
      TMPDIR: '/tmp',
    }),
    {
      HOME: '/home/reviewer',
      HTTPS_PROXY: 'http://proxy.example.test:8080',
      NODE_EXTRA_CA_CERTS: '/etc/company-ca.pem',
      NO_PROXY: 'localhost,127.0.0.1',
      PATH: '/usr/bin',
      SSL_CERT_FILE: '/etc/ssl/cert.pem',
      TMPDIR: '/tmp',
    },
  );
});

test('reads structured output from each coding agent', () => {
  const response = { change: { title: 'A note' } };
  assert.deepEqual(
    parseAgentResponse('codex', JSON.stringify(response)),
    response,
  );
  assert.deepEqual(
    parseAgentResponse(
      'claude',
      JSON.stringify({ structured_output: response }),
    ),
    response,
  );
  assert.deepEqual(
    parseAgentResponse('copilot', `\`\`\`json\n${JSON.stringify(response)}\n\`\`\``),
    response,
  );
  assert.deepEqual(
    parseAgentResponse(
      'cursor',
      JSON.stringify({
        type: 'result',
        result: `\`\`\`json\n${JSON.stringify(response)}\n\`\`\``,
      }),
    ),
    response,
  );
  assert.deepEqual(
    parseAgentResponse(
      'opencode',
      `${JSON.stringify({
        type: 'text',
        part: { text: JSON.stringify(response) },
      })}\n`,
    ),
    response,
  );
  assert.throws(
    () =>
      parseAgentResponse(
        'opencode',
        `${JSON.stringify({ type: 'step_finish' })}\n`,
      ),
    /OpenCode did not return summary JSON/,
  );
});

test('uses the Cursor Agent binary name and allows an override', () => {
  assert.equal(codingAgentBinary('cursor', { env: {} }), 'cursor-agent');
  assert.equal(
    codingAgentBinary('cursor', {
      env: { CURSOR_BIN: '/custom/cursor-agent' },
    }),
    '/custom/cursor-agent',
  );
});
