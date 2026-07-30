import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentCommand,
  codingAgentBinary,
  parseAgentResponse,
  selectCodingAgent,
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
  await assert.rejects(
    selectCodingAgent(undefined, async () => false),
    /no coding agent is available/i,
  );
});

test('fails when the requested coding agent is unavailable', async () => {
  await assert.rejects(
    selectCodingAgent('claude', async () => false),
    /claude.*not available/i,
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
  };

  const codex = agentCommand({ ...common, agent: 'codex' });
  assert.deepEqual(codex.args.slice(0, 2), ['exec', '--ephemeral']);
  assert.ok(codex.args.includes('--output-schema'));
  assert.ok(codex.args.includes('--skip-git-repo-check'));
  assert.equal(codex.input, 'stdin');

  const claude = agentCommand({ ...common, agent: 'claude' });
  assert.ok(claude.args.includes('--json-schema'));
  assert.ok(claude.args.includes('--no-session-persistence'));
  assert.equal(claude.input, 'stdin');

  const copilot = agentCommand({ ...common, agent: 'copilot' });
  assert.ok(copilot.args.includes('--silent'));
  assert.ok(copilot.args.includes('--no-ask-user'));
  assert.match(copilot.args.at(-1), /@\/tmp\/input\.json/);

  const cursor = agentCommand({ ...common, agent: 'cursor' });
  assert.deepEqual(cursor.args.slice(0, 4), [
    '--print',
    '--trust',
    '--output-format',
    'json',
  ]);
  assert.ok(!cursor.args.includes('--force'));
  assert.ok(!cursor.args.includes('--yolo'));
  assert.ok(cursor.args.includes('--model'));
  assert.match(cursor.args.at(-1), /@input\.json/);
  assert.equal(cursor.cwd, '/tmp');

  const opencode = agentCommand({ ...common, agent: 'opencode' });
  assert.deepEqual(opencode.args.slice(0, 4), [
    'run',
    '--pure',
    '--format',
    'json',
  ]);
  assert.ok(opencode.args.includes('--file'));
  assert.ok(opencode.args.includes('--variant'));
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
