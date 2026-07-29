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

function stop(child) {
  return new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
    child.kill('SIGTERM');
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

test('increments the requested port when automatic selection is enabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diffsplain-port-'));
  const output = join(directory, 'diff-data.json');
  const blocker = createServer();
  let child;

  try {
    await writeFile(output, '{}');
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', resolve);
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
