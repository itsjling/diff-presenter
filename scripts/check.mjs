import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.env.npm_execpath
  ? { command: process.execPath, prefix: [process.env.npm_execpath] }
  : { command: 'npm', prefix: [] };

async function runCommand(command, args) {
  await new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
    });

    child.once('error', rejectCommand);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      rejectCommand(new Error(`exited with ${code ?? signal ?? 'an error'}`));
    });
  });
}

function runNpm(args) {
  return runCommand(npm.command, [...npm.prefix, ...args]);
}

function execNpm(args, options) {
  return execFileAsync(npm.command, [...npm.prefix, ...args], options);
}

async function runStage(name, run) {
  console.log(`\n==> ${name}`);

  try {
    await run();
  } catch (error) {
    throw new Error(`${name} failed: ${error.message}`);
  }

  console.log(`✓ ${name}`);
}

async function smokeTestPackage() {
  const packageRoot = await mkdtemp(join(tmpdir(), 'diffsplain-package-'));
  const consumerRoot = join(packageRoot, 'consumer');

  try {
    const { stdout } = await execNpm(
      ['pack', '--ignore-scripts', '--json', '--pack-destination', packageRoot],
      { cwd: root },
    );
    const [pack] = JSON.parse(stdout);
    const tarball = join(packageRoot, pack.filename);

    await mkdir(consumerRoot);
    await writeFile(
      join(consumerRoot, 'package.json'),
      JSON.stringify({ private: true, name: 'diffsplain-smoke-test' }),
    );
    await execNpm(
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
      { cwd: consumerRoot },
    );

    const packageJson = JSON.parse(
      await readFile(join(consumerRoot, 'node_modules/diffsplain/package.json')),
    );
    const executable = resolve(
      consumerRoot,
      'node_modules/diffsplain',
      packageJson.bin.diffsplain,
    );
    await execFileAsync(process.execPath, [executable, '--version'], {
      cwd: consumerRoot,
    });

    if (packageJson.name !== 'diffsplain') {
      throw new Error('packed package has the wrong name');
    }
  } finally {
    await rm(packageRoot, { force: true, recursive: true });
  }
}

const stages = [
  ['React and TypeScript lint', () => runNpm(['run', 'lint'])],
  ['Production app build', () => runNpm(['run', 'build'])],
  ['Unit and integration tests', () => runNpm(['run', 'test:run'])],
  ['Documentation checks', () => runNpm(['run', 'docs:check'])],
  ['Production docs build', () => runNpm(['run', 'docs:build'])],
];

try {
  for (const [name, run] of stages) {
    await runStage(name, run);
  }
  await runStage('Packed-package smoke test', smokeTestPackage);
} catch (error) {
  console.error(`\nCheck stopped: ${error.message}`);
  process.exitCode = 1;
}
