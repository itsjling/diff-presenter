import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
      const match = output.match(/Diff Presenter: (http:\/\/[^\s]+)/);
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
  const directory = await mkdtemp(join(tmpdir(), 'diff-presenter-server-'));
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

    const [page, data] = await Promise.all([
      fetch(url),
      fetch(`${url}/diff-data.json`),
    ]);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Diff Presenter<\/title>/i);
    assert.deepEqual(await data.json(), { version: 'test-version' });
    assert.equal(data.headers.get('cache-control'), 'no-store');
  } finally {
    if (child && child.exitCode === null) await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
});
