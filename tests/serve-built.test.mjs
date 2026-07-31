import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('../scripts/serve-built.mjs', import.meta.url).pathname;

function waitForUrl(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`Built server did not start: ${output}`));
    }, 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/Diffsplain: (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Built server exited with ${code}: ${output}`));
    });
  });
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`Built server did not report readiness: ${output}`));
    }, 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      for (const line of output.split('\n')) {
        try {
          const event = JSON.parse(line);
          if (event.event === 'ready') {
            clearTimeout(timer);
            resolve(event);
            return;
          }
        } catch {
          // The server also writes human-readable status lines.
        }
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Built server exited with ${code}: ${output}`));
    });
  });
}

function waitForText(stream, pattern) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`Did not find ${pattern}: ${output}`));
    }, 10_000);
    stream.on('data', (chunk) => {
      output += chunk;
      if (pattern.test(output)) {
        clearTimeout(timer);
        resolve(output);
      }
    });
  });
}

function stop(child) {
  return new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
    child.kill('SIGTERM');
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Built server did not exit after its bind error'));
    }, 10_000);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test('serves the built review page with live diff data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-server-'));
  const output = join(directory, 'diff-data.json');
  let child;

  try {
    await writeFile(output, JSON.stringify({ version: 'test-version' }));
    child = spawn(
      process.execPath,
      [script, '--output', output, '--port', '0'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const url = await waitForUrl(child);
    assert.equal(new URL(url).hostname, 'localhost');

    const [page, data, missing] = await Promise.all([
      fetch(url),
      fetch(`${url}/diff-data.json`),
      fetch(`${url}/assets/missing.js`),
    ]);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Diffsplain<\/title>/i);
    assert.deepEqual(await data.json(), { version: 'test-version' });
    assert.equal(data.headers.get('cache-control'), 'no-store');
    assert.equal(missing.status, 404);
  } finally {
    if (child && child.exitCode === null) await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test('reports a matching project tab connection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-tab-'));
  const output = join(directory, 'diff-data.json');
  let child;
  let reader;

  try {
    await writeFile(output, '{}');
    child = spawn(
      process.execPath,
      [
        script,
        '--output',
        output,
        '--port',
        '0',
        '--project',
        'project-key',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const url = new URL(await waitForUrl(child));
    assert.equal(url.hostname, 'localhost');
    assert.equal(url.hash, '#project=project-key');

    const connected = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Server did not report the tab connection')),
        2_000,
      );
      child.stdout.on('data', (chunk) => {
        if (chunk.toString().includes('Diffsplain tab: connected')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const eventsUrl = new URL('events', url);
    eventsUrl.searchParams.set('project', 'project-key');
    const response = await fetch(eventsUrl);
    reader = response.body.getReader();
    await reader.read();
    await connected;
  } finally {
    await reader?.cancel();
    if (child && child.exitCode === null) await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test('reports machine-readable readiness and closes its health endpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-health-'));
  const output = join(directory, 'diff-data.json');
  let child;

  try {
    await writeFile(output, '{}');
    child = spawn(
      process.execPath,
      [script, '--output', output, '--port', '0'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const ready = await waitForReady(child);
    assert.ok(['127.0.0.1', '::1'].includes(ready.address));
    assert.ok(ready.port > 0);
    assert.equal(ready.url, `http://localhost:${ready.port}`);

    const health = await fetch(`${ready.url}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: 'ok',
      address: ready.address,
      port: ready.port,
    });

    assert.equal(await stop(child), 0);
    await assert.rejects(fetch(`${ready.url}/health`));
  } finally {
    if (child && child.exitCode === null) await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test('warns before binding the review to a remote address', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-remote-'));
  const output = join(directory, 'diff-data.json');
  let child;

  try {
    await writeFile(output, '{}');
    child = spawn(
      process.execPath,
      [script, '--output', output, '--port', '0', '--host', '0.0.0.0'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const warning = waitForText(child.stderr, /anyone who can reach/i);
    const ready = await waitForReady(child);
    await warning;
    assert.equal(ready.address, '0.0.0.0');
    assert.ok(ready.port > 0);

    const health = await fetch(`http://127.0.0.1:${ready.port}/health`);
    assert.equal(health.status, 200);
  } finally {
    if (child && child.exitCode === null) await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test('exits with an error when the requested host cannot bind', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-bind-error-'));
  const output = join(directory, 'diff-data.json');
  let child;
  let stdout = '';
  let stderr = '';

  try {
    await writeFile(output, '{}');
    child = spawn(
      process.execPath,
      [
        script,
        '--output',
        output,
        '--port',
        '0',
        '--host',
        '192.0.2.1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    assert.deepEqual(await waitForExit(child), { code: 1, signal: null });
    assert.match(stderr, /Could not start Diffsplain/);
    assert.doesNotMatch(stdout, /"event":"ready"/);
  } finally {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
});

test('pushes an event soon after live diff data changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-events-'));
  const output = join(directory, 'diff-data.json');
  let child;
  let reader;

  try {
    await writeFile(output, JSON.stringify({ version: 'before' }));
    child = spawn(
      process.execPath,
      [script, '--output', output, '--port', '0'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const url = await waitForUrl(child);
    const response = await fetch(`${url}/events`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = decoder.decode((await reader.read()).value);
    assert.match(buffered, /event: ready/);

    const started = performance.now();
    await writeFile(output, JSON.stringify({ version: 'after' }));
    while (!buffered.includes('event: update')) {
      const next = await reader.read();
      assert.equal(next.done, false);
      buffered += decoder.decode(next.value);
    }
    assert.ok(
      performance.now() - started < 500,
      'expected an update event within 500 ms',
    );
  } finally {
    await reader?.cancel();
    if (child && child.exitCode === null) await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test('increments the requested port when automatic selection is enabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-port-'));
  const output = join(directory, 'diff-data.json');
  const blocker = createServer();
  let child;

  try {
    await writeFile(output, '{}');
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, 'localhost', resolve);
    });
    const address = blocker.address();
    assert.ok(address && typeof address === 'object');

    child = spawn(
      process.execPath,
      [
        script,
        '--output',
        output,
        '--port',
        String(address.port),
        '--increment-port',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const url = new URL(await waitForUrl(child));

    assert.ok(Number(url.port) > address.port);
    assert.equal((await fetch(url)).status, 200);
  } finally {
    if (child && child.exitCode === null) await stop(child);
    await new Promise((resolve) => blocker.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
