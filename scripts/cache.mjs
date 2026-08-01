import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { defaultCacheRoot } from './summary-path.mjs';

export const leaseDurationMs = 5 * 60_000;

function files(root) {
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    });
  } catch {
    return [];
  }
}

function leaseRecord(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return typeof value?.token === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function leaseIsActive(path, now = Date.now(), duration = leaseDurationMs) {
  try {
    return now - statSync(path).mtimeMs < duration;
  } catch {
    return false;
  }
}

function createLease(path, record, duration) {
  const descriptor = openSync(path, 'wx', 0o600);
  writeFileSync(descriptor, `${JSON.stringify(record)}\n`);
  closeSync(descriptor);
  return { path, token: record.token, duration };
}

function renameLease(path, stalePath) {
  try {
    renameSync(path, stalePath);
    return true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return false;
  }
}

function restoreLease(path, stalePath) {
  try {
    linkSync(stalePath, path);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  rmSync(stalePath, { force: true });
}

export function removeStaleLease(path, observedToken) {
  const stalePath = `${path}.stale-${randomUUID()}`;
  if (!renameLease(path, stalePath)) return false;
  if (leaseRecord(stalePath)?.token === observedToken) {
    rmSync(stalePath, { force: true });
    return true;
  }
  restoreLease(path, stalePath);
  return false;
}

function rejectNonConflict(error) {
  if (error?.code !== 'EEXIST') throw error;
}

function rejectActiveLease(active, path) {
  if (active) {
    throw new Error(`Notes for this target are already being generated: ${path}`);
  }
}

function handleLeaseConflict(error, path, now, duration) {
  rejectNonConflict(error);
  const observed = leaseRecord(path);
  rejectActiveLease(leaseIsActive(path, now, duration), path);
  removeStaleLease(path, observed?.token);
}

export function acquireLease(path, {
  token = randomUUID(),
  now = Date.now(),
  duration = leaseDurationMs,
  pid = process.pid,
  leaseHostname = hostname(),
} = {}) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      return createLease(
        path,
        { token, startedAt: now, pid, hostname: leaseHostname },
        duration,
      );
    } catch (error) {
      handleLeaseConflict(error, path, now, duration);
    }
  }
}

function assertLease(lease) {
  if (leaseRecord(lease.path)?.token !== lease.token) {
    throw new Error('This process no longer owns the note cache');
  }
}

export function refreshLease(lease, now = Date.now()) {
  assertLease(lease);
  utimesSync(lease.path, new Date(now), new Date(now));
  assertLease(lease);
}

export function releaseLease(lease) {
  assertLease(lease);
  unlinkSync(lease.path);
}

export function writePrivateFile(path, value) {
  writeFileAtomic(path, value, 0o600);
}

function existingFileMode(path) {
  try {
    return statSync(path).mode & 0o777;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return undefined;
  }
}

function chmodIfSet(path, mode) {
  if (mode !== undefined) chmodSync(path, mode);
}

function writeFileAtomic(path, value, mode) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const outputMode = mode === undefined ? existingFileMode(path) : mode;
  writeFileSync(
    temporary,
    value,
    outputMode === undefined ? undefined : { mode: outputMode },
  );
  chmodIfSet(temporary, outputMode);
  renameSync(temporary, path);
  chmodIfSet(path, outputMode);
}

export function publishLeaseFile(
  lease,
  path,
  value,
  { privateFile = true } = {},
) {
  assertLease(lease);
  refreshLease(lease);
  if (privateFile) writePrivateFile(path, value);
  else writeFileAtomic(path, value);
  assertLease(lease);
}

function active(path, now) {
  return leaseIsActive(`${path}.lock`, now);
}

function sameEntry(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function fileSize(path) {
  try {
    return statSync(path).size;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return undefined;
  }
}

function removedCacheEntry() {
  return { removed: true, retainedActive: false, size: 0 };
}

function cacheEntryState(entry, removedPath, now) {
  return {
    changed: !sameEntry(entry, statSync(removedPath)),
    retainedActive: active(entry.path, now),
    replaced: typeof fileSize(entry.path) === 'number',
  };
}

function restoreCacheEntry(entry, removedPath, retainedActive) {
  restoreLease(entry.path, removedPath);
  return {
    removed: false,
    retainedActive,
    size: fileSize(entry.path) ?? 0,
  };
}

export function removeCacheEntry(entry, now = Date.now()) {
  const removedPath = `${entry.path}.remove-${randomUUID()}`;
  if (!renameLease(entry.path, removedPath)) return removedCacheEntry();
  const state = cacheEntryState(entry, removedPath, now);
  if ([state.changed, state.retainedActive, state.replaced].includes(true)) {
    return restoreCacheEntry(entry, removedPath, state.retainedActive);
  }
  rmSync(removedPath, { force: true });
  return removedCacheEntry();
}

function entries(cacheRoot) {
  return files(join(cacheRoot, 'summaries'))
    .filter((path) => path.endsWith('.json'))
    .map((path) => ({ path, ...statSync(path) }));
}

function activeLeases(cacheRoot, now) {
  return files(join(cacheRoot, 'summaries')).filter(
    (path) => path.endsWith('.json.lock') && leaseIsActive(path, now),
  );
}

export function cacheStatus({ cacheRoot = defaultCacheRoot(), now = Date.now() } = {}) {
  const cached = entries(cacheRoot);
  const bytes = cached.reduce((sum, entry) => sum + entry.size, 0);
  const ages = cached.map((entry) => now - entry.mtimeMs);
  return {
    location: cacheRoot,
    entries: cached.length,
    bytes,
    ageMs: ages.length ? Math.max(...ages) : 0,
    active: activeLeases(cacheRoot, now).length,
  };
}

function shouldPrune(entry, { maxAgeMs, maxBytes, now, bytes }) {
  const overAge =
    maxAgeMs !== undefined && now - entry.mtimeMs > maxAgeMs;
  const overSize = maxBytes !== undefined && bytes > maxBytes;
  return overAge || overSize;
}

function applyPruneResult(entry, result, removed, retainedActive) {
  if (result.removed) {
    removed.push(entry.path);
    return -entry.size;
  }
  if (result.retainedActive) retainedActive.push(entry.path);
  return result.size - entry.size;
}

export function pruneCache({ cacheRoot = defaultCacheRoot(), maxAgeMs, maxBytes, now = Date.now() } = {}) {
  const cached = entries(cacheRoot).sort((a, b) => a.mtimeMs - b.mtimeMs);
  let bytes = cached.reduce((sum, entry) => sum + entry.size, 0);
  const removed = [];
  const retainedActive = [];
  for (const entry of cached) {
    if (!shouldPrune(entry, { maxAgeMs, maxBytes, now, bytes })) continue;
    const result = removeCacheEntry(entry, now);
    bytes += applyPruneResult(entry, result, removed, retainedActive);
  }
  return { removed, retainedActive, bytes };
}

export function clearCache(options) {
  return pruneCache({ ...options, maxAgeMs: 0 });
}

export function formatCacheStatus(status) {
  return `Location: ${status.location}\nSize: ${status.bytes} bytes\nOldest entry: ${Math.floor(status.ageMs / 1000)} seconds\nActive use: ${status.active} target${status.active === 1 ? '' : 's'}`;
}
