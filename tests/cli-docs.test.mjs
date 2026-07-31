import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  cliOptions,
  helpText,
  parseCliArgs,
} from '../scripts/cli-args.mjs';

const [docs, agentNotes, packageText] = await Promise.all([
  readFile(new URL('../docs/content/cli.mdx', import.meta.url), 'utf8'),
  readFile(new URL('../docs/content/agent-notes.mdx', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
]);

test('lists each accepted option in public help and the CLI reference', () => {
  const acceptedOptions = Object.keys(cliOptions);
  assert.ok(acceptedOptions.length > 15);
  for (const option of acceptedOptions) {
    const pattern = new RegExp(
      option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    assert.match(docs, pattern);
    assert.match(helpText, pattern);
  }

  for (const match of helpText.matchAll(/--[a-z][a-z-]*/g)) {
    assert.match(docs, new RegExp(match[0]));
  }
});

test('documents provider inputs and limits', () => {
  for (const name of [
    'CODEX_BIN',
    'CLAUDE_BIN',
    'COPILOT_BIN',
    'CURSOR_BIN',
    'OPENCODE_BIN',
  ]) {
    assert.match(docs, new RegExp(name));
  }
  assert.match(docs, /Only Codex and OpenCode accept `--reasoning`/);
  assert.match(agentNotes, /only Codex and\s+OpenCode accept `--reasoning`/);
  assert.doesNotMatch(agentNotes, /--agent claude[\s\S]{0,100}--reasoning/);
});

test('derives documented numeric defaults and bounds from the parser', () => {
  const batchSize = cliOptions['--batch-size'];
  const jobs = cliOptions['--jobs'];
  const port = cliOptions['--port'];
  assert.match(
    docs,
    new RegExp(
      `--batch-size\` defaults to \`${batchSize.default}\`[\\s\\S]*` +
      `\`${batchSize.min}\` through \`${batchSize.max}\``,
    ),
  );
  assert.match(
    docs,
    new RegExp(
      `--jobs\` defaults\\s+to \`${jobs.default}\` and accepts ` +
      `\`${jobs.min}\` through \`${jobs.max}\``,
    ),
  );
  assert.match(
    docs,
    new RegExp(
      `--port\` accepts \`${port.min}\` through \`${port.max}\``,
    ),
  );
  assert.equal(parseCliArgs([]).port, port.default);
  for (const [name, record] of [
    ['--batch-size', batchSize],
    ['--jobs', jobs],
    ['--port', port],
  ]) {
    assert.doesNotThrow(() =>
      parseCliArgs([name, String(record.min)]));
    assert.doesNotThrow(() =>
      parseCliArgs([name, String(record.max)]));
    assert.throws(() =>
      parseCliArgs([name, String(record.max + 1)]));
  }
});

test('pins first-run lifecycle facts in the docs check', () => {
  assert.match(docs, /npx diffsplain doctor/);
  assert.match(docs, /browser cannot open[\s\S]*open that URL yourself/);
  assert.match(docs, /Ctrl/);
  assert.match(docs, /Normal shutdown removes temporary page and agent\s+input files/);
  assert.match(docs, /Saved notes remain in the user cache/);
  assert.match(
    docs,
    /Fetched Git objects remain\s+in the installed package's `\.cache\/git` folder/,
  );

  const packageJson = JSON.parse(packageText);
  assert.match(packageJson.scripts['docs:check'], /tests\/cli-docs\.test\.mjs/);
});
