import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  agentFallbackRecordNeeded,
  agentRunCompleted,
  agentRunFailed,
  agentRunNeeded,
  agentRunSuperseded,
  browserCommand,
  ensureBuiltAssets,
  failedAgentRunForFingerprint,
  nextAgentFingerprint,
  openBrowser,
} from '../scripts/presenter-runtime.mjs';

const url = 'http://localhost:2299';

test('does not schedule a completed agent fingerprint again', () => {
  assert.equal(agentRunNeeded('same', { completedFingerprint: 'same' }), false);
  assert.equal(agentRunNeeded('same', { activeFingerprint: 'same' }), false);
  assert.equal(agentRunNeeded('same', { failedFingerprint: 'same' }), false);
  assert.equal(
    agentRunNeeded('changed', { completedFingerprint: 'same' }),
    true,
  );
});

test('does not complete a superseded agent job that exits cleanly', () => {
  assert.equal(
    agentRunCompleted({
      code: 0,
      error: undefined,
      signal: null,
      superseded: true,
    }),
    false,
  );
  assert.equal(
    agentRunCompleted({
      code: 0,
      error: undefined,
      signal: null,
      superseded: false,
    }),
    true,
  );
});

test('classifies failed agent runs and selects pending work', () => {
  const failure = new Error('agent failed');
  assert.equal(agentRunSuperseded('next', 'current'), true);
  assert.equal(agentRunSuperseded('current', 'current'), false);
  assert.equal(
    agentFallbackRecordNeeded({
      closing: false,
      error: failure,
    }),
    true,
  );
  assert.equal(
    agentFallbackRecordNeeded({
      closing: false,
      queuedFingerprint: 'next',
      error: failure,
    }),
    false,
  );
  assert.equal(
    agentFallbackRecordNeeded({
      closing: false,
      code: 1,
    }),
    false,
  );
  assert.equal(
    agentRunFailed({
      closing: false,
      code: 1,
      superseded: false,
    }),
    true,
  );
  assert.equal(
    agentRunFailed({
      closing: false,
      code: 1,
      superseded: true,
    }),
    false,
  );
  assert.equal(
    nextAgentFingerprint({
      queuedFingerprint: 'next',
      observedFingerprint: 'observed',
      finishedFingerprint: 'current',
    }),
    'next',
  );
  assert.equal(
    nextAgentFingerprint({
      observedFingerprint: 'observed',
      finishedFingerprint: 'current',
    }),
    'observed',
  );
  assert.equal(
    nextAgentFingerprint({
      observedFingerprint: 'current',
      finishedFingerprint: 'current',
    }),
    undefined,
  );
});

test('retries a failed fingerprint after observing another diff', () => {
  let failedFingerprint = 'first';
  assert.equal(
    agentRunNeeded('first', { failedFingerprint }),
    false,
  );

  failedFingerprint = failedAgentRunForFingerprint(
    failedFingerprint,
    'second',
  );
  assert.equal(failedFingerprint, undefined);
  assert.equal(
    agentRunNeeded('first', { failedFingerprint }),
    true,
  );
});

test('selects a browser command for every supported platform', () => {
  assert.deepEqual(browserCommand({ url, platform: 'darwin' }), {
    command: 'open',
    args: [url],
  });
  assert.deepEqual(browserCommand({ url, platform: 'win32' }), {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', 'start', '', url],
  });
  assert.deepEqual(browserCommand({ url, platform: 'linux' }), {
    command: 'xdg-open',
    args: [url],
  });
  assert.deepEqual(browserCommand({ url, browser: '/custom/browser' }), {
    command: '/custom/browser',
    args: [url],
  });
});

test('reports browser launch failures without throwing', () => {
  const child = new EventEmitter();
  let unref = false;
  child.unref = () => {
    unref = true;
  };
  const failures = [];

  openBrowser(url, {
    platform: 'linux',
    spawnProcess: (command, args, options) => {
      assert.equal(command, 'xdg-open');
      assert.deepEqual(args, [url]);
      assert.deepEqual(options, { detached: true, stdio: 'ignore' });
      return child;
    },
    onError: (error) => failures.push(error.message),
  });
  child.emit('error', new Error('browser missing'));

  assert.deepEqual(failures, ['browser missing']);
  assert.equal(unref, true);
});

test('builds missing assets once and reports a failed build clearly', () => {
  const files = new Set();
  const exists = (file) => files.has(file);
  const calls = [];
  const root = '/tmp/diffsplain';
  const index = `${root}/dist/index.html`;
  const assets = `${root}/dist/assets`;

  assert.equal(
    ensureBuiltAssets({
      root,
      exists,
      run: (command, args) => {
        calls.push({ command, args });
        files.add(index);
        files.add(assets);
        return { status: 0 };
      },
    }),
    true,
  );
  assert.deepEqual(calls, [{ command: 'npm', args: ['run', 'build'] }]);
  assert.equal(ensureBuiltAssets({ root, exists, run: () => assert.fail() }), false);

  let failedCalls = 0;
  assert.throws(
    () =>
      ensureBuiltAssets({
        root: '/tmp/missing-diffsplain',
        exists: () => false,
        run: () => {
          failedCalls += 1;
          return { status: 2 };
        },
      }),
    /npm run build exited with 2/i,
  );
  assert.equal(failedCalls, 1);
});
