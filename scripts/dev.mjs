#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function childStatus(code, signal) {
  if (code !== null) return code;
  return signal || "unknown";
}

function childExitCode(code) {
  return code === null ? 1 : code;
}

// fallow-ignore-next-line complexity -- this validates the full dev-only command surface.
export function parseDevelopmentArgs(rawArgs, callerDirectory = process.cwd()) {
  const [mode, ...args] = rawArgs;
  if (!["live", "mock"].includes(mode)) {
    throw new Error('Use "live" or "mock".');
  }
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!["--repo", "--fixture", "--port", "--delay"].includes(name)) {
      throw new Error(`Unknown option: ${name}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
    if (values.has(name)) throw new Error(`${name} was passed more than once`);
    values.set(name, value);
    index += 1;
  }
  if (mode === "live" && values.has("--fixture")) {
    throw new Error("--fixture is only available in mock mode");
  }
  if (mode === "mock" && values.has("--repo")) {
    throw new Error("--repo is only available in live mode");
  }
  const port = values.get("--port") || "2299";
  if (!/^\d+$/.test(port) || Number(port) > 65_535) {
    throw new Error("--port must be a number from 0 to 65535");
  }
  const delay = values.get("--delay") || "750";
  if (!/^\d+$/.test(delay) || Number(delay) < 10 || Number(delay) > 60_000) {
    throw new Error("--delay must be a number from 10 to 60000");
  }
  return {
    mode,
    port,
    delay,
    repo: resolve(callerDirectory, values.get("--repo") || callerDirectory),
    fixture: resolve(
      callerDirectory,
      values.get("--fixture") || resolve(root, "public/demo-diff-data.json"),
    ),
  };
}

export function developmentCommands(options, output) {
  const clientReady = join(dirname(output), "client-ready");
  const watcher =
    options.mode === "live"
      ? {
          command: process.execPath,
          args: [
            resolve(root, "scripts/build-diff-data.mjs"),
            "--repo",
            options.repo,
            "--worktree",
            "--watch",
            "--watch-content",
            "--output",
            output,
          ],
        }
      : {
          command: process.execPath,
          args: [
            resolve(root, "scripts/mock-agent.mjs"),
            "--fixture",
            options.fixture,
            "--delay",
            options.delay,
            "--start-file",
            join(dirname(output), "page-ready"),
            "--advance-file",
            clientReady,
            "--output",
            output,
          ],
        };
  return {
    watcher,
    vite: {
      command: process.execPath,
      args: [
        resolve(root, "node_modules/vite/bin/vite.js"),
        "--host",
        "127.0.0.1",
        "--port",
        options.port,
      ],
      env: {
        DIFFSPLAIN_LIVE_OUTPUT: output,
        ...(options.mode === "mock"
          ? { DIFFSPLAIN_LIVE_ACK: clientReady }
          : {}),
      },
    },
  };
}

export function isDevelopmentEntry(argument, moduleUrl) {
  return Boolean(argument) && pathToFileURL(resolve(argument)).href === moduleUrl;
}

export function viteServerUrl(output) {
  return stripVTControlCharacters(output).match(
    /Local:\s+(http:\/\/[^\s]+)/,
  )?.[1];
}

// fallow-ignore-next-line complexity -- this supervisor owns both child lifecycles.
async function main() {
  const options = parseDevelopmentArgs(process.argv.slice(2));
  if (!existsSync(options.mode === "live" ? options.repo : options.fixture)) {
    throw new Error(
      options.mode === "live"
        ? `Repo does not exist: ${options.repo}`
        : `Fixture does not exist: ${options.fixture}`,
    );
  }
  const runtimeDirectory = mkdtempSync(join(tmpdir(), "diffsplain-dev-"));
  const output = join(runtimeDirectory, "diff-data.json");
  const { watcher, vite } = developmentCommands(options, output);
  let closing = false;
  let pageReady = false;
  const children = new Set();
  const stop = async (code = 0) => {
    if (closing) return;
    closing = true;
    for (const child of children) {
      if (!child.killed) child.kill("SIGTERM");
    }
    await Promise.all(
      [...children].map((child) =>
        child.exitCode === null ? once(child, "exit") : Promise.resolve(),
      ),
    );
    rmSync(runtimeDirectory, { recursive: true, force: true });
    process.exitCode = code;
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  const watchChild = spawn(watcher.command, watcher.args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(watchChild);
  const viteChild = spawn(vite.command, vite.args, {
    cwd: root,
    env: { ...process.env, ...vite.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(viteChild);
  for (const [name, child] of [
    ["watcher", watchChild],
    ["Vite", viteChild],
  ]) {
    child.on("error", (error) => {
      if (!closing) {
        console.error(`Could not start ${name}: ${error.message}`);
        void stop(1);
      }
    });
    child.on("exit", (code, signal) => {
      children.delete(child);
      if (!closing) {
        console.error(`${name} stopped (${childStatus(code, signal)}).`);
        void stop(childExitCode(code));
      }
    });
  }
  function relayWatcherLine(line) {
    if (line) console.log(`[${options.mode}] ${line}`);
  }
  for (const stream of [watchChild.stdout, watchChild.stderr]) {
    createInterface({ input: stream }).on("line", relayWatcherLine);
  }
  function relayViteLine(line) {
    const url = viteServerUrl(line);
    if (url && !pageReady) {
      pageReady = true;
      writeFileSync(join(runtimeDirectory, "page-ready"), "ready\n");
      console.log(`Diffsplain ${options.mode} ready: ${url}`);
    }
    if (line) console.log(`[vite] ${line}`);
  }
  for (const stream of [viteChild.stdout, viteChild.stderr]) {
    createInterface({ input: stream }).on("line", relayViteLine);
  }
}

if (isDevelopmentEntry(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
