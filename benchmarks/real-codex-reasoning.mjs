#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const runs = Number(option("--runs", "3"));
const reasoning = option("--reasoning", "default");
const resultFile = option("--result-file");

if (!Number.isInteger(runs) || runs < 1) {
  throw new Error("--runs must be a positive integer");
}
if (!["default", "minimal", "low"].includes(reasoning)) {
  throw new Error("--reasoning must be default, minimal, or low");
}

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
}

function git(repo, ...gitArgs) {
  return run("git", ["-C", repo, ...gitArgs]);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

const temporary = mkdtempSync(join(tmpdir(), "diffsplain-real-agent-"));
const repo = join(temporary, "repo");
const output = join(temporary, "diff-data.json");
const summaries = join(temporary, "summaries.json");

try {
  mkdirSync(repo);
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "benchmark@example.test");
  git(repo, "config", "user.name", "Benchmark");
  git(repo, "config", "commit.gpgsign", "false");
  for (let index = 0; index < 4; index += 1) {
    writeFileSync(
      join(repo, `module-${index}.js`),
      `export function value${index}() {\n  return ${index};\n}\n`,
    );
  }
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  for (let index = 0; index < 4; index += 1) {
    writeFileSync(
      join(repo, `module-${index}.js`),
      `export function value${index}() {\n  return ${index + 10};\n}\n`,
    );
  }

  run(
    process.execPath,
    [
      resolve(projectRoot, "scripts/build-diff-data.mjs"),
      "--repo",
      repo,
      "--worktree",
      "--output",
      output,
    ],
    { cwd: projectRoot },
  );

  const samples = [];
  const titles = [];
  for (let index = 0; index < runs; index += 1) {
    const commandArgs = [
      resolve(projectRoot, "scripts/generate-summaries.mjs"),
      "--repo",
      repo,
      "--worktree",
      "--snapshot",
      output,
      "--output",
      output,
      "--summaries",
      summaries,
      "--force",
      "--jobs",
      "1",
    ];
    if (reasoning !== "default") {
      commandArgs.push("--reasoning", reasoning);
    }
    const started = performance.now();
    run(process.execPath, commandArgs, { cwd: projectRoot });
    samples.push(performance.now() - started);
    const value = JSON.parse(readFileSync(summaries, "utf8"));
    if (
      value.meta?.status !== "complete" ||
      Object.keys(value.files || {}).length !== 4
    ) {
      throw new Error("Codex returned incomplete benchmark notes");
    }
    titles.push(value.change.title);
  }

  const result = {
    reasoning,
    runs,
    medianMs: Math.round(median(samples) * 10) / 10,
    samplesMs: samples.map((value) => Math.round(value * 10) / 10),
    titles,
  };
  const encoded = `${JSON.stringify(result, null, 2)}\n`;
  if (resultFile) writeFileSync(resolve(resultFile), encoded);
  process.stdout.write(encoded);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
