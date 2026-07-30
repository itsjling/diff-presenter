import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const benchmark = new URL(
  '../benchmarks/live-update-speed.mjs',
  import.meta.url,
).pathname;

for (const [mode, sampleCount] of [
  ['events', 9],
  ['poll', 7],
]) {
  test(`runs the protected ${mode} live-update benchmark`, async () => {
    const { stdout } = await run(process.execPath, [
      benchmark,
      '--mode',
      mode,
    ], {
      timeout: 30_000,
    });
    const result = JSON.parse(stdout);

    assert.equal(result.mode, mode);
    assert.equal(result.samplesMs.length, sampleCount);
    assert.ok(result.samplesMs.every((sample) => Number.isFinite(sample)));
  });
}
