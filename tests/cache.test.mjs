import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  acquireLease,
  cacheStatus,
  clearCache,
  leaseDurationMs,
  publishLeaseFile,
  pruneCache,
  releaseLease,
  removeCacheEntry,
  removeStaleLease,
  writePrivateFile,
} from '../scripts/cache.mjs';

test('fences a delayed writer after stale-lease recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diffsplain-cache-'));
  const note = join(root, 'summaries', 'target.json');
  const lock = `${note}.lock`;
  const now = Date.now();
  try {
    const older = acquireLease(lock, {
      token: 'older',
      now,
      pid: 999_999,
    });
    publishLeaseFile(older, note, 'older result');
    await utimes(lock, new Date(now - leaseDurationMs - 1), new Date(now - leaseDurationMs - 1));
    const newer = acquireLease(lock, { token: 'newer', now });
    publishLeaseFile(newer, note, 'newer result');

    assert.throws(() => publishLeaseFile(older, note, 'late older result'), /no longer owns/i);
    assert.equal(await readFile(note, 'utf8'), 'newer result');
    assert.throws(() => releaseLease(older), /no longer owns/i);
    assert.equal(await readFile(lock, 'utf8').then(JSON.parse).then((lease) => lease.token), 'newer');
    releaseLease(newer);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('does not remove a new lease found during stale recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diffsplain-cache-'));
  const lock = join(root, 'summaries', 'target.json.lock');
  try {
    acquireLease(lock, {
      token: 'observed-stale',
      now: 0,
      pid: 999_999,
    });
    await writeFile(
      lock,
      `${JSON.stringify({
        token: 'new-owner',
        startedAt: Date.now(),
        pid: process.pid,
        hostname: 'test-host',
      })}\n`,
    );

    assert.equal(removeStaleLease(lock, 'observed-stale'), false);
    assert.equal(
      JSON.parse(await readFile(lock, 'utf8')).token,
      'new-owner',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pruning and explicit clearing keep entries with an active lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diffsplain-cache-'));
  const old = join(root, 'summaries', 'old.json');
  const active = join(root, 'summaries', 'active.json');
  let lease;
  try {
    writePrivateFile(old, 'old');
    writePrivateFile(active, 'active');
    await utimes(old, new Date(0), new Date(0));
    await utimes(active, new Date(0), new Date(0));
    lease = acquireLease(`${active}.lock`);

    const pruned = pruneCache({ cacheRoot: root, maxAgeMs: 1 });
    assert.deepEqual(pruned.removed, [old]);
    assert.deepEqual(pruned.retainedActive, [active]);
    assert.equal(cacheStatus({ cacheRoot: root }).active, 1);
    assert.deepEqual(clearCache({ cacheRoot: root }).removed, []);
    assert.deepEqual(clearCache({ cacheRoot: root }).retainedActive, [active]);
  } finally {
    if (lease) releaseLease(lease);
    await rm(root, { recursive: true, force: true });
  }
});

test('does not remove an entry replaced after the prune snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diffsplain-cache-'));
  const note = join(root, 'summaries', 'target.json');
  const lock = `${note}.lock`;
  try {
    writePrivateFile(note, 'observed result');
    const observed = { path: note, ...(await stat(note)) };
    const lease = acquireLease(lock);
    publishLeaseFile(lease, note, 'new result');
    releaseLease(lease);

    const result = removeCacheEntry(observed);

    assert.equal(result.removed, false);
    assert.equal(result.retainedActive, false);
    assert.equal(await readFile(note, 'utf8'), 'new result');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reports a first-run lease before its cache entry exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diffsplain-cache-'));
  let lease;

  try {
    const lock = join(root, 'summaries', 'first-run.json.lock');
    lease = acquireLease(lock);
    assert.equal(cacheStatus({ cacheRoot: root }).entries, 0);
    assert.equal(cacheStatus({ cacheRoot: root }).active, 1);
  } finally {
    if (lease) releaseLease(lease);
    await rm(root, { recursive: true, force: true });
  }
});

test('writes private cache files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diffsplain-cache-'));
  const file = join(root, 'summaries', 'private.json');
  try {
    writePrivateFile(file, 'private notes');
    assert.equal((await stat(file)).mode & 0o077, 0);
    assert.equal(await readFile(file, 'utf8'), 'private notes');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
