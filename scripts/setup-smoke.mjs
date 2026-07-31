import { execFile, spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.env.npm_execpath
  ? { command: process.execPath, prefix: [process.env.npm_execpath] }
  : { command: 'npm', prefix: [] };
const setupInputs = [
  '.npmrc',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'package.json',
];

async function run(command, args, cwd) {
  await new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', rejectCommand);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolveCommand();
      rejectCommand(new Error(`exited with ${code ?? signal ?? 'an error'}`));
    });
  });
}

async function missing(path) {
  await access(path).then(
    () => {
      throw new Error(`Fresh worktree unexpectedly contains ${path}`);
    },
    (error) => {
      if (error.code !== 'ENOENT') throw error;
    },
  );
}

export async function assertSetupInputsClean(repository) {
  const { stdout } = await execFileAsync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all', '--', ...setupInputs],
    { cwd: repository },
  );
  if (!stdout.trim()) return;

  throw new Error(
    'Setup inputs have uncommitted changes. Commit or stash them before running setup:smoke.',
  );
}

async function main() {
  await assertSetupInputsClean(root);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'diffsplain-worktree-'));
  const worktree = join(temporaryRoot, 'checkout');
  let worktreeCreated = false;

  try {
    await execFileAsync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], {
      cwd: root,
    });
    worktreeCreated = true;
    await missing(join(worktree, 'node_modules'));
    await missing(join(worktree, '.cache', 'diff-data.json'));

    await run(npm.command, [...npm.prefix, 'run', 'setup'], worktree);
    await access(join(worktree, 'node_modules'));
    await missing(join(worktree, '.cache', 'diff-data.json'));
    console.log(`✓ Fresh worktree passed setup: ${worktree}`);
  } finally {
    if (worktreeCreated) {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktree], {
        cwd: root,
      });
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
