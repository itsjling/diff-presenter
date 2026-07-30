#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

const output = resolve(option("--output"));
const fixture = resolve(option("--fixture"));
const delay = Number(option("--delay", "750"));
const startFile = option("--start-file");
const advanceFile = option("--advance-file");
if (!Number.isSafeInteger(delay) || delay < 10 || delay > 60_000) {
  throw new Error("--delay must be a whole number from 10 to 60000");
}

let timer;
let stopped = false;
let awaitedVersion;
let releaseStage;

function readFixture() {
  const snapshot = JSON.parse(readFileSync(fixture, "utf8"));
  if (!Array.isArray(snapshot.files)) {
    throw new Error("Mock fixture must contain files");
  }
  return snapshot;
}

function writeSnapshot(snapshot) {
  const text = JSON.stringify(snapshot, null, 2);
  const version = createHash("sha256").update(text).digest("hex").slice(0, 12);
  const next = {
    ...snapshot,
    version,
    generatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temporary, output);
  return version;
}

function withNotes(snapshot, status, completedFiles) {
  return {
    ...snapshot,
    files: snapshot.files.map((file, index) => ({
      ...file,
      noteReady: index < completedFiles,
    })),
    notes: {
      fresh: status !== "failed",
      complete: status === "complete",
      status,
      completedFiles,
      totalFiles: snapshot.files.length,
    },
  };
}

function scheduleNextStage(publish, index, total) {
  if (index >= total) return;
  if (advanceFile) {
    releaseStage = () => {
      releaseStage = undefined;
      timer = setTimeout(publish, delay);
    };
    return;
  }
  timer = setTimeout(publish, delay);
}

function readAdvanceVersion(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
}

function startScenario() {
  clearTimeout(timer);
  awaitedVersion = undefined;
  releaseStage = undefined;
  if (advanceFile) rmSync(resolve(advanceFile), { force: true });
  let fixtureData;
  try {
    fixtureData = readFixture();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return;
  }
  const stages = [
    ["generating", 0, "waiting"],
    ["generating", Math.min(1, fixtureData.files.length), "progress"],
    ["failed", Math.min(1, fixtureData.files.length), "failed"],
    ["generating", Math.min(1, fixtureData.files.length), "retrying"],
    ["complete", fixtureData.files.length, "complete"],
  ];
  let index = 0;
  const publish = () => {
    if (stopped) return;
    const [status, completedFiles, label] = stages[index];
    awaitedVersion = writeSnapshot(
      withNotes(fixtureData, status, completedFiles),
    );
    console.log(`Mock notes: ${label}`);
    index += 1;
    scheduleNextStage(publish, index, stages.length);
  };
  publish();
}

watchFile(fixture, { interval: 100 }, (current, previous) => {
  if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
    console.log("Mock fixture changed; restarting notes.");
    startScenario();
  }
});
process.on("SIGINT", () => {
  stopped = true;
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopped = true;
  process.exit(0);
});

if (advanceFile) {
  const resolvedAdvanceFile = resolve(advanceFile);
  watchFile(resolvedAdvanceFile, { interval: 25 }, (current) => {
    if (current.nlink === 0 || !releaseStage) return;
    if (readAdvanceVersion(resolvedAdvanceFile) !== awaitedVersion) return;
    releaseStage();
  });
}

if (startFile) {
  const resolvedStartFile = resolve(startFile);
  watchFile(resolvedStartFile, { interval: 50 }, (current) => {
    if (current.nlink === 0) return;
    unwatchFile(resolvedStartFile);
    startScenario();
  });
} else {
  startScenario();
}
