import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export function summaryPath({
  projectRoot,
  callerDirectory,
  repo,
  explicit,
  pr,
  branch,
  base,
  head,
  remote = 'origin',
}) {
  if (explicit) return resolve(callerDirectory, explicit);
  if (!pr && !branch && !(base && head)) {
    return resolve(repo, '.beautiful-diffs/summaries.json');
  }

  const pullRequest =
    pr?.match(/\/pull\/(\d+)(?:\/|$)/)?.[1] || pr || undefined;
  const target = pr
    ? { kind: 'pr', pullRequest, remote }
    : branch
      ? { kind: 'branch', branch, base: base || 'default', remote }
      : { kind: 'range', base, head };
  const key = createHash('sha256')
    .update(JSON.stringify({ repo, target }))
    .digest('hex')
    .slice(0, 24);
  return resolve(projectRoot, '.cache/summaries', `${target.kind}-${key}.json`);
}
