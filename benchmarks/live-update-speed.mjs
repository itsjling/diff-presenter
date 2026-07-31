#!/usr/bin/env node

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import {
  mkdtempSync,
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
const mode = option("--mode", "events");
const resultFile = option("--result-file");
if (!["events", "poll"].includes(mode)) {
  throw new Error("--mode must be events or poll");
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function waitForUrl(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    let output = "";
    const timer = setTimeout(
      () => rejectPromise(new Error(`Server did not start: ${output}`)),
      10_000,
    );
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/Diffsplain: (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolvePromise(match[1]);
      }
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", rejectPromise);
  });
}

function stop(child) {
  return new Promise((resolvePromise) => {
    child.once("exit", resolvePromise);
    child.kill("SIGTERM");
  });
}

function protectedUrl(reviewUrl, path) {
  const route = new URL(path, reviewUrl);
  const access = new URLSearchParams(new URL(reviewUrl).hash.slice(1)).get(
    "access",
  );
  if (access) route.searchParams.set("access", access);
  return route;
}

const temporary = mkdtempSync(join(tmpdir(), "diffsplain-updates-"));
const output = join(temporary, "diff-data.json");
writeFileSync(output, JSON.stringify({ version: "0" }));
const child = spawn(
  process.execPath,
  [
    resolve(projectRoot, "scripts/serve-built.mjs"),
    "--output",
    output,
    "--port",
    "0",
  ],
  { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] },
);

let reader;
let poll;
try {
  const url = await waitForUrl(child);
  const samples = [];
  if (mode === "events") {
    const response = await fetch(protectedUrl(url, "events"));
    if (!response.ok) {
      throw new Error(`Event stream returned ${response.status}`);
    }
    reader = response.body.getReader();
    await reader.read();
    for (let version = 1; version <= 9; version += 1) {
      const started = performance.now();
      writeFileSync(output, JSON.stringify({ version: String(version) }));
      const event = await reader.read();
      if (event.done) throw new Error("Event stream closed");
      samples.push(performance.now() - started);
    }
  } else {
    let seenVersion = "0";
    const waiters = new Map();
    poll = setInterval(async () => {
      const response = await fetch(protectedUrl(url, "diff-data.json"), {
        cache: "no-store",
      });
      const value = await response.json();
      if (value.version === seenVersion) return;
      seenVersion = value.version;
      waiters.get(seenVersion)?.();
    }, 1_500);
    const phases = [100, 300, 500, 700, 900, 1_100, 1_300];
    for (let index = 0; index < phases.length; index += 1) {
      await wait(phases[index]);
      const version = String(index + 1);
      const seen = new Promise((resolvePromise) => {
        waiters.set(version, resolvePromise);
      });
      const started = performance.now();
      writeFileSync(output, JSON.stringify({ version }));
      await seen;
      samples.push(performance.now() - started);
    }
  }

  const result = {
    mode,
    medianMs: Math.round(median(samples) * 10) / 10,
    samplesMs: samples.map((value) => Math.round(value * 10) / 10),
  };
  const encoded = `${JSON.stringify(result, null, 2)}\n`;
  if (resultFile) writeFileSync(resolve(resultFile), encoded);
  process.stdout.write(encoded);
} finally {
  if (poll) clearInterval(poll);
  await reader?.cancel();
  await stop(child);
  rmSync(temporary, { recursive: true, force: true });
}
