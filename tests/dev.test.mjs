import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  developmentCommands,
  isDevelopmentEntry,
  parseDevelopmentArgs,
  viteServerUrl,
} from "../scripts/dev.mjs";

const script = new URL("../scripts/dev.mjs", import.meta.url).pathname;

function waitFor(read, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const retry = async () => {
      try {
        const value = await read();
        if (value) return resolve(value);
      } catch {}
      if (Date.now() >= deadline) {
        reject(new Error("Timed out waiting for development mode"));
        return;
      }
      setTimeout(retry, 40);
    };
    void retry();
  });
}

function start(args) {
  const child = spawn(process.execPath, [script, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      output += chunk;
    });
  }
  return { child, output: () => output };
}

function waitForReady(process) {
  return waitFor(() => {
    const match = process.output().match(/Diffsplain \w+ ready:\s+(http:\/\/\S+)/);
    return match ? new URL(match[1]) : undefined;
  });
}

function stop(child) {
  return new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
    child.kill("SIGTERM");
  });
}

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("builds separate live and mock child commands", () => {
  const live = parseDevelopmentArgs(["live", "--repo", "target"], "/work");
  const mock = parseDevelopmentArgs(["mock", "--fixture", "fixture.json"], "/work");
  const liveCommands = developmentCommands(live, "/tmp/live.json");
  const mockCommands = developmentCommands(mock, "/tmp/mock.json");

  assert.ok(liveCommands.watcher.args.some((arg) => arg.endsWith("build-diff-data.mjs")));
  assert.ok(liveCommands.watcher.args.includes("--watch"));
  assert.ok(mockCommands.watcher.args.some((arg) => arg.endsWith("mock-agent.mjs")));
  assert.ok(mockCommands.watcher.args.includes("--start-file"));
  assert.ok(mockCommands.watcher.args.includes("--advance-file"));
  assert.equal(mockCommands.vite.env.DIFFSPLAIN_LIVE_OUTPUT, "/tmp/mock.json");
  assert.equal(mockCommands.vite.env.DIFFSPLAIN_LIVE_ACK, "/tmp/client-ready");
  assert.equal(
    isDevelopmentEntry(script, pathToFileURL(script).href),
    true,
  );
  assert.throws(
    () => parseDevelopmentArgs(["mock", "--repo", "target"], "/work"),
    /only available in live mode/,
  );
  assert.throws(
    () => parseDevelopmentArgs(["mock", "--delay", "1"], "/work"),
    /10 to 60000/,
  );
});

test("parses Vite's URL when its ready line contains color codes", () => {
  const output = [
    "\u001b[32m  ➜  Loc",
    "al\u001b[0m:   http://127.0.0.1:4173/\n",
  ].join("");

  assert.equal(viteServerUrl(output), "http://127.0.0.1:4173/");
});

test("mock mode serves progress, failure, retry, and fixture changes over SSE", async () => {
  const directory = await mkdtemp(join(tmpdir(), "diffsplain-dev-mock-"));
  const fixture = join(directory, "fixture.json");
  let process;
  let reader;

  try {
    await writeFile(
      fixture,
      await readFile(new URL("../public/demo-diff-data.json", import.meta.url)),
    );
    process = start(["mock", "--fixture", fixture, "--delay", "250", "--port", "0"]);
    const url = await waitForReady(process);
    const initial = await waitFor(async () => {
      const response = await fetch(new URL("diff-data.json", url));
      return response.ok ? response.json() : undefined;
    });
    assert.equal(initial.notes.status, "generating");
    assert.ok(initial.notes.completedFiles < initial.notes.totalFiles);

    const events = await fetch(new URL("events", url));
    reader = events.body.getReader();
    const decoder = new TextDecoder();
    let eventText = decoder.decode((await reader.read()).value);
    const states = new Set([initial.notes.status]);
    await waitFor(async () => {
      const response = await fetch(new URL("diff-data.json", url));
      const snapshot = response.ok ? await response.json() : undefined;
      if (snapshot) states.add(snapshot.notes.status);
      return snapshot?.notes.status === "complete" ? snapshot : undefined;
    });
    while (!eventText.includes("event: update")) {
      const next = await reader.read();
      assert.equal(next.done, false);
      eventText += decoder.decode(next.value);
    }
    assert.ok(states.has("failed"));
    assert.ok(states.has("generating"));
    assert.ok(states.has("complete"));

    const changed = JSON.parse(await readFile(fixture, "utf8"));
    changed.change.title = "Fixture update";
    await writeFile(fixture, JSON.stringify(changed));
    const refreshed = await waitFor(async () => {
      const response = await fetch(new URL("diff-data.json", url));
      const snapshot = response.ok ? await response.json() : undefined;
      return snapshot?.change.title === "Fixture update" ? snapshot : undefined;
    });
    assert.equal(refreshed.notes.status, "generating");
  } finally {
    await reader?.cancel();
    if (process?.child.exitCode === null) await stop(process.child);
    await rm(directory, { recursive: true, force: true });
  }
});

test("live mode serves watcher output through Vite without a production build", async () => {
  const directory = await mkdtemp(join(tmpdir(), "diffsplain-dev-live-"));
  const repo = join(directory, "repo");
  let process;
  let reader;

  try {
    await mkdir(repo);
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "diffsplain@example.test");
    git(repo, "config", "user.name", "Diffsplain");
    git(repo, "config", "commit.gpgsign", "false");
    await writeFile(join(repo, "note.txt"), "before\n");
    git(repo, "add", "note.txt");
    git(repo, "commit", "-qm", "base");
    await writeFile(join(repo, "note.txt"), "after\n");

    process = start(["live", "--repo", repo, "--port", "0"]);
    const url = await waitForReady(process);
    const first = await waitFor(async () => {
      const response = await fetch(new URL("diff-data.json", url));
      return response.ok ? response.json() : undefined;
    });
    assert.deepEqual(first.files.map((file) => file.path), ["note.txt"]);

    const events = await fetch(new URL("events", url));
    reader = events.body.getReader();
    const decoder = new TextDecoder();
    let eventText = decoder.decode((await reader.read()).value);
    await writeFile(join(repo, "note.txt"), "after again\n");
    await waitFor(async () => {
      const response = await fetch(new URL("diff-data.json", url));
      const snapshot = response.ok ? await response.json() : undefined;
      return snapshot?.files[0]?.patch.includes("after again") ? snapshot : undefined;
    }, 6_000);
    while (!eventText.includes("event: update")) {
      const next = await reader.read();
      assert.equal(next.done, false);
      eventText += decoder.decode(next.value);
    }
  } finally {
    await reader?.cancel();
    if (process?.child.exitCode === null) await stop(process.child);
    await rm(directory, { recursive: true, force: true });
  }
});
