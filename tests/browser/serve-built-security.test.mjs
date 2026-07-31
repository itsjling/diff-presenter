import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { chromium } from '@playwright/test';

const root = new URL('../..', import.meta.url).pathname;
const script = new URL('../../scripts/serve-built.mjs', import.meta.url).pathname;
const snapshot = new URL('../../public/demo-diff-data.json', import.meta.url)
  .pathname;

function startServer() {
  const child = spawn(process.execPath, [
    script,
    '--output',
    snapshot,
    '--port',
    '0',
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error(`Built server did not start: ${output}`)),
      10_000,
    );
    child.stdout.on('data', (chunk) => {
      output += chunk;
      for (const line of output.split('\n')) {
        try {
          const event = JSON.parse(line);
          if (event.event !== 'ready') continue;
          clearTimeout(timer);
          resolve(event);
          return;
        } catch {
          // The server also writes a browser URL.
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Built server exited with ${code}: ${output}`));
    });
  });
  return { child, ready };
}

test('renders a compiled diff with the restrictive CSP', async () => {
  const { child, ready } = startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  try {
    const session = await ready;
    await page.goto(`${session.url}#access=${session.access}`);
    const renderer = page.getByLabel('Unified code diff');
    await renderer.waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('diffs-container')].some(
        (element) => element.shadowRoot?.querySelector('style'),
      ),
    );
    const size = await renderer.boundingBox();

    assert.ok(size && size.height > 0 && size.width > 0);
    assert.deepEqual(
      browserErrors.filter((message) =>
        /content security policy|refused to apply.*style/i.test(message),
      ),
      [],
    );
  } finally {
    await page.close();
    await browser.close();
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }
});
