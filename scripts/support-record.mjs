import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { writePrivateFile } from './cache.mjs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const stageNames = ['cache', 'snapshot', 'agent', 'publish', 'serve'];
const byteNames = ['snapshot', 'agentInput', 'agentOutput'];
const providers = new Set([
  'codex',
  'claude',
  'copilot',
  'cursor',
  'opencode',
]);
const versionPattern =
  /^\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
const providerLabels = {
  codex: /\bcodex(?:-cli)?\b/i,
  claude: /\bclaude\b/i,
  copilot: /\b(?:github\s+)?copilot\b/i,
  cursor: /\bcursor(?:-agent)?\b/i,
  opencode: /\bopencode\b/i,
};

function boundedNumber(value) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.round(value), Number.MAX_SAFE_INTEGER);
}

function safeVersion(value) {
  const version = String(value || '').replace(/^v/, '');
  if (version.length > 64) return null;
  return versionPattern.test(version) ? version : null;
}

export function versionEnvironment(env = process.env) {
  const names = [
    'COMSPEC',
    'LANG',
    'LC_ALL',
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
  ];
  return Object.fromEntries(
    names
      .filter((name) => typeof env[name] === 'string')
      .map((name) => [name, env[name]]),
  );
}

function usableVersionResult(result) {
  return result.status === 0 && !result.error;
}

function versionOutput(command, run, env) {
  try {
    const result = run(command, ['--version'], {
      encoding: 'utf8',
      env: versionEnvironment(env),
      maxBuffer: 64 * 1024,
      timeout: 2_000,
    });
    if (!usableVersionResult(result)) return '';
    return String(result.stdout || '');
  } catch {
    return '';
  }
}

function versionFromOutput(provider, output) {
  const line = output
    .split(/\r?\n/)
    .find((value) => providerLabels[provider]?.test(value));
  return line?.match(
    /(?:^|\s)v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?)(?:\s|$)/,
  )?.[1];
}

export function safeCommandVersion(
  provider,
  command,
  {
    run = spawnSync,
    env = process.env,
  } = {},
) {
  return safeVersion(
    versionFromOutput(provider, versionOutput(command, run, env)),
  );
}

function cleanProvider(provider) {
  return providers.has(provider) ? provider : 'unknown';
}

function clippedIntervals(intervals, startedTick, endedTick) {
  return intervals
    .map(([start, end]) => [
      Math.max(startedTick, Math.min(endedTick, start)),
      Math.max(startedTick, Math.min(endedTick, end)),
    ])
    .filter(([start, end]) => end >= start)
    .sort(([left], [right]) => left - right);
}

function mergeIntervals(intervals) {
  return intervals.reduce((merged, interval) => {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], interval[1]);
    } else {
      merged.push([...interval]);
    }
    return merged;
  }, []);
}

function unionDuration(intervals, startedTick, endedTick) {
  const merged = mergeIntervals(
    clippedIntervals(intervals, startedTick, endedTick),
  );
  return boundedNumber(
    merged.reduce((total, [start, end]) => total + end - start, 0),
  );
}

function stageRecord(stages, startedTick, endedTick) {
  return Object.fromEntries(
    stageNames
      .filter((name) => stages[name].calls > 0)
      .map((name) => [
        name,
        {
          durationMs: unionDuration(
            stages[name].intervals,
            startedTick,
            endedTick,
          ),
          calls: stages[name].calls,
          state: stages[name].state,
        },
      ]),
  );
}

export function createSupportRecorder({
  provider,
  providerVersion,
  now = () => new Date(),
  clock = () => performance.now(),
  runId = randomUUID(),
} = {}) {
  const startedAt = now().toISOString();
  const startedTick = clock();
  const stages = Object.fromEntries(
    stageNames.map((name) => [
      name,
      { intervals: [], calls: 0, state: 'ok' },
    ]),
  );
  const bytes = Object.fromEntries(byteNames.map((name) => [name, 0]));
  let failedStage;
  let selectedProvider = provider;
  let selectedProviderVersion = providerVersion;

  function addStageInterval(name, start, end, state) {
    if (!stageNames.includes(name)) return;
    stages[name].intervals.push([start, end]);
    stages[name].calls = boundedNumber(stages[name].calls + 1);
    if (state === 'failed') {
      stages[name].state = 'failed';
      failedStage ||= name;
    }
  }

  return {
    setProvider(name, version) {
      selectedProvider = name;
      selectedProviderVersion = version;
    },
    startStage(name) {
      const stageStarted = clock();
      let finished = false;
      return (state = 'ok') => {
        if (finished) return;
        finished = true;
        addStageInterval(name, stageStarted, clock(), state);
      };
    },
    addBytes(name, value) {
      if (!byteNames.includes(name)) return;
      bytes[name] = boundedNumber(bytes[name] + boundedNumber(value));
    },
    addStage(name, durationMs, state = 'ok') {
      const stageEnded = clock();
      addStageInterval(
        name,
        stageEnded - boundedNumber(durationMs),
        stageEnded,
        state,
      );
    },
    failure(code = 1) {
      const endedTick = Math.max(startedTick, clock());
      return {
        schemaVersion: 1,
        runId: /^[0-9a-f-]{36}$/i.test(runId) ? runId : randomUUID(),
        startedAt,
        durationMs: boundedNumber(endedTick - startedTick),
        provider: {
          name: cleanProvider(selectedProvider),
          version: safeVersion(selectedProviderVersion),
        },
        tools: {
          diffsplain: safeVersion(packageJson.version),
          node: safeVersion(process.versions.node),
        },
        stages: stageRecord(stages, startedTick, endedTick),
        bytes: { ...bytes },
        exit: {
          state: 'failed',
          code: boundedNumber(code),
          stage: failedStage || 'unknown',
        },
      };
    },
  };
}

export function formatSupportRecord(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function writeSupportRecord(path, record) {
  writePrivateFile(path, formatSupportRecord(record));
}
