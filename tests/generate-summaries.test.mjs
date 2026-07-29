import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("../scripts/generate-summaries.mjs", import.meta.url)
  .pathname;

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function makeRepo() {
  const repo = await mkdtemp(join(tmpdir(), "diffsplain-summaries-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "diffsplain@example.test");
  git(repo, "config", "user.name", "Diffsplain");
  await writeFile(join(repo, "changed.txt"), "before\n");
  git(repo, "add", "changed.txt");
  git(repo, "commit", "-qm", "base");

  await writeFile(join(repo, "changed.txt"), "after\n");
  await writeFile(join(repo, "added.txt"), "new file\n");
  git(repo, "add", "changed.txt", "added.txt");
  git(repo, "commit", "-qm", "change");
  return repo;
}

async function fakeCodex(root, response) {
  const bin = join(root, "fake-codex.mjs");
  const argsFile = join(root, "codex-args.json");
  const responseFile = join(root, "codex-response.json");
  await writeFile(responseFile, JSON.stringify(response));
  await writeFile(
    bin,
    `#!/usr/bin/env node
import { writeFileSync, readFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(readFileSync(${JSON.stringify(responseFile)}, "utf8"));
`,
  );
  await chmod(bin, 0o755);
  return { bin, argsFile };
}

async function recordingCodex(root) {
  const bin = join(root, "recording-codex.mjs");
  const calls = join(root, "codex-calls.jsonl");
  await writeFile(
    bin,
    `#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
const input = JSON.parse(readFileSync(0, "utf8"));
const call = existsSync(${JSON.stringify(calls)})
  ? readFileSync(${JSON.stringify(calls)}, "utf8").trim().split("\\n").length + 1
  : 1;
appendFileSync(
  ${JSON.stringify(calls)},
  JSON.stringify({
    files: input.files.map((file) => file.path),
    existing: Object.keys(input.existingFileNotes || {}).sort(),
  }) + "\\n",
);
const response = {
  change: {
    title: "Change note " + call,
    summary: "Summarizes call " + call + ".",
    why: "Covers selective note regeneration.",
    highlights: [],
    risks: [],
  },
};
if (input.files.length) {
  response.files = input.files.map((file) => ({
    path: file.path,
    title: "Note " + call + " for " + file.path,
    what: "Explains " + file.path + ".",
    why: "This file changed.",
    details: [],
    risks: [],
  }));
}
process.stdout.write(JSON.stringify(response));
`,
  );
  await chmod(bin, 0o755);
  await writeFile(
    join(root, ".git", "info", "exclude"),
    "recording-codex.mjs\ncodex-calls.jsonl\n",
  );
  return { bin, calls };
}

async function recordedCalls(file) {
  return (await readFile(file, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function run(repo, args, options = {}) {
  return spawnSync(process.execPath, [script, "--repo", repo, ...args], {
    encoding: "utf8",
    ...options,
  });
}

async function waitFor(read, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw lastError || new Error("Timed out waiting for generated notes");
}

function notes(files) {
  return {
    change: {
      title: "Update two files",
      summary: "Updates one file and adds another.",
      why: "Covers the summary generator.",
      highlights: ["Both files have notes."],
      risks: [],
    },
    files,
  };
}

test("generates notes with Codex and rebuilds a selected range", async () => {
  const repo = await makeRepo();
  const summaries = join(repo, "notes.json");
  const output = join(repo, "diff-data.json");

  try {
    const codex = await fakeCodex(
      repo,
      notes({
        "added.txt": {
          title: "Add a text file",
          what: "Adds the new file.",
          why: "Provides the new content.",
          details: ["The file contains one line."],
          risks: [],
        },
        "changed.txt": {
          title: "Update text",
          what: "Replaces the old line.",
          why: "Changes the stored value.",
          details: [],
          risks: ["Consumers may rely on the old value."],
        },
      }),
    );

    const result = run(repo, [
      "--range",
      "HEAD~1..HEAD",
      "--codex-bin",
      codex.bin,
      "--model",
      "gpt-test",
      "--reasoning",
      "low",
      "--summaries",
      summaries,
      "--output",
      output,
    ]);
    assert.equal(result.status, 0, result.stderr);

    const args = JSON.parse(await readFile(codex.argsFile, "utf8"));
    assert.equal(args[0], "exec");
    assert.ok(
      args.includes("--output-schema"),
      `expected structured Codex output, got: ${args.join(" ")}`,
    );
    assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), [
      "--model",
      "gpt-test",
    ]);
    assert.ok(args.includes('model_reasoning_effort="low"'));

    const writtenNotes = JSON.parse(await readFile(summaries, "utf8"));
    assert.deepEqual(
      { change: writtenNotes.change, files: writtenNotes.files },
      notes(writtenNotes.files),
    );
    assert.match(writtenNotes.meta.reviewFingerprint, /^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(writtenNotes.meta.generatedAt)));
    assert.deepEqual(Object.keys(writtenNotes.files).sort(), [
      "added.txt",
      "changed.txt",
    ]);

    const snapshot = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(
      snapshot.files.map((file) => file.path),
      ["added.txt", "changed.txt"],
    );
    assert.equal(snapshot.files[0].summary.title, "Add a text file");
    assert.equal(snapshot.files[1].summary.title, "Update text");
    assert.equal(
      snapshot.notes.generatedFor,
      snapshot.notes.reviewFingerprint,
    );
    assert.equal(snapshot.notes.fresh, true);
    assert.equal(snapshot.notes.complete, true);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("generates notes with Claude, Copilot, and OpenCode", async () => {
  for (const agent of ["claude", "copilot", "opencode"]) {
    const repo = await makeRepo();
    const summaries = join(repo, `${agent}-notes.json`);
    const output = join(repo, `${agent}-diff-data.json`);
    const binDirectory = join(repo, "bin");
    const bin = join(binDirectory, agent);
    const response = notes({
      "added.txt": {
        title: "Add a text file",
        what: "Adds the new file.",
        why: "Provides the new content.",
        details: [],
        risks: [],
      },
      "changed.txt": {
        title: "Update text",
        what: "Replaces the old line.",
        why: "Changes the stored value.",
        details: [],
        risks: [],
      },
    });

    try {
      await mkdir(binDirectory);
      await writeFile(
        bin,
        `#!/usr/bin/env node
const agent = ${JSON.stringify(agent)};
const response = ${JSON.stringify(response)};
if (agent === "claude") {
  process.stdout.write(JSON.stringify({ structured_output: response }));
} else if (agent === "opencode") {
  process.stdout.write(JSON.stringify({
    type: "text",
    part: { text: JSON.stringify(response) },
  }) + "\\n");
} else {
  process.stdout.write(JSON.stringify(response));
}
`,
      );
      await chmod(bin, 0o755);

      const result = run(
        repo,
        [
          "--range",
          "HEAD~1..HEAD",
          "--agent",
          agent,
          "--summaries",
          summaries,
          "--output",
          output,
        ],
        {
          env: {
            ...process.env,
            PATH: `${binDirectory}:${process.env.PATH}`,
          },
        },
      );
      assert.equal(result.status, 0, `${agent}: ${result.stderr}`);

      const writtenNotes = JSON.parse(await readFile(summaries, "utf8"));
      assert.deepEqual(writtenNotes.files, response.files);
      const snapshot = JSON.parse(await readFile(output, "utf8"));
      assert.equal(snapshot.notes.complete, true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }
});

test("keeps notes fresh when the rebuilt output is a changed tracked file", async () => {
  const repo = await makeRepo();
  const summaries = join(repo, "notes.json");
  const output = join(repo, "diff-data.json");

  try {
    await writeFile(output, '{"old":true}\n');
    git(repo, "add", "diff-data.json");
    git(repo, "commit", "-qm", "track generated output");
    await writeFile(output, '{"changed":true}\n');
    await writeFile(join(repo, "changed.txt"), "worktree change\n");

    const codex = await fakeCodex(
      repo,
      notes({
        "changed.txt": {
          title: "Update text",
          what: "Replaces the stored line.",
          why: "Covers worktree notes.",
          details: [],
          risks: [],
        },
      }),
    );
    await writeFile(
      join(repo, ".git", "info", "exclude"),
      "codex-args.json\ncodex-response.json\nfake-codex.mjs\n",
    );
    const result = run(repo, [
      "--codex-bin",
      codex.bin,
      "--summaries",
      summaries,
      "--output",
      output,
    ]);
    assert.equal(result.status, 0, result.stderr);

    const writtenNotes = JSON.parse(await readFile(summaries, "utf8"));
    const snapshot = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(snapshot.files.map((file) => file.path), ["changed.txt"]);
    assert.equal(
      writtenNotes.meta.reviewFingerprint,
      snapshot.notes.reviewFingerprint,
    );
    assert.equal(snapshot.notes.fresh, true);
    assert.equal(snapshot.notes.complete, true);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("marks note generation as failed when Codex misses a changed file", async () => {
  const repo = await makeRepo();
  const summaries = join(repo, "notes.json");
  const output = join(repo, "diff-data.json");

  try {
    const codex = await fakeCodex(
      repo,
      notes({
        "changed.txt": {
          title: "Update text",
          what: "Replaces the old line.",
          why: "Changes the stored value.",
          details: [],
          risks: [],
        },
      }),
    );
    const result = run(repo, [
      "--range",
      "HEAD~1..HEAD",
      "--codex-bin",
      codex.bin,
      "--summaries",
      summaries,
      "--output",
      output,
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /added\.txt|every changed file|missing/i);
    const writtenNotes = JSON.parse(await readFile(summaries, "utf8"));
    assert.equal(writtenNotes.meta.status, "failed");
    assert.deepEqual(writtenNotes.files, {});

    const snapshot = JSON.parse(await readFile(output, "utf8"));
    assert.equal(snapshot.notes.status, "failed");
    assert.equal(snapshot.notes.completedFiles, 0);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("shows coding agent stderr when note generation fails", async () => {
  const repo = await makeRepo();
  const summaries = join(repo, "notes.json");
  const output = join(repo, "diff-data.json");
  const codexBin = join(repo, "failing-codex");

  try {
    await writeFile(
      codexBin,
      "#!/bin/sh\n" +
        "printf 'Not inside a trusted directory.\\n' >&2\n" +
        "exit 1\n",
    );
    await chmod(codexBin, 0o755);

    const result = run(repo, [
      "--range",
      "HEAD~1..HEAD",
      "--codex-bin",
      codexBin,
      "--summaries",
      summaries,
      "--output",
      output,
    ]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Not inside a trusted directory/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("publishes each completed file batch before the full run ends", async () => {
  const repo = await makeRepo();
  const summaries = join(repo, "notes.json");
  const output = join(repo, "diff-data.json");
  const codexBin = join(repo, "progressive-codex.mjs");
  const calls = join(repo, "codex-calls.txt");
  let child;

  try {
    await writeFile(
      codexBin,
      `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const input = JSON.parse(readFileSync(0, "utf8"));
const call = existsSync(${JSON.stringify(calls)})
  ? Number(readFileSync(${JSON.stringify(calls)}, "utf8")) + 1
  : 1;
writeFileSync(${JSON.stringify(calls)}, String(call));
if (call === 2) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900);
}
process.stdout.write(JSON.stringify({
  change: {
    title: "Update two files",
    summary: "Updates one file and adds another.",
    why: "Covers progressive note generation.",
    highlights: [],
    risks: [],
  },
  files: input.files.map((file) => ({
    path: file.path,
    title: "Note for " + file.path,
    what: "Explains " + file.path + ".",
    why: "This file is part of the change.",
    details: [],
    risks: [],
  })),
}));
`,
    );
    await chmod(codexBin, 0o755);

    child = spawn(
      process.execPath,
      [
        script,
        "--repo",
        repo,
        "--range",
        "HEAD~1..HEAD",
        "--codex-bin",
        codexBin,
        "--batch-size",
        "1",
        "--jobs",
        "1",
        "--summaries",
        summaries,
        "--output",
        output,
      ],
      { encoding: "utf8", stdio: "pipe" },
    );

    const partial = await waitFor(async () => {
      const value = JSON.parse(await readFile(summaries, "utf8"));
      const snapshot = JSON.parse(await readFile(output, "utf8"));
      return value.meta?.status === "generating" &&
        Object.keys(value.files || {}).length === 1 &&
        snapshot.notes?.completedFiles === 1
        ? { value, snapshot }
        : undefined;
    });
    assert.deepEqual(Object.keys(partial.value.files), ["added.txt"]);

    const partialSnapshot = partial.snapshot;
    assert.equal(partialSnapshot.notes.status, "generating");
    assert.equal(partialSnapshot.notes.completedFiles, 1);
    assert.equal(partialSnapshot.files[0].noteReady, true);
    assert.equal(partialSnapshot.files[1].noteReady, false);

    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    child = undefined;
    assert.deepEqual(result, { code: 0, signal: null });

    const complete = JSON.parse(await readFile(summaries, "utf8"));
    assert.equal(complete.meta.status, "complete");
    assert.deepEqual(Object.keys(complete.files).sort(), [
      "added.txt",
      "changed.txt",
    ]);

    const finalSnapshot = JSON.parse(await readFile(output, "utf8"));
    assert.equal(finalSnapshot.notes.status, "complete");
    assert.equal(finalSnapshot.notes.completedFiles, 2);
    assert.equal(finalSnapshot.notes.complete, true);
  } finally {
    if (child && !child.killed) child.kill("SIGTERM");
    await rm(repo, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test("accepts the array form required by the Codex output schema", async () => {
  const repo = await makeRepo();
  const summaries = join(repo, "notes.json");
  const output = join(repo, "diff-data.json");

  try {
    const complete = notes({
      "added.txt": {
        title: "Add a text file",
        what: "Adds the new file.",
        why: "Provides the new content.",
        details: [],
        risks: [],
      },
      "changed.txt": {
        title: "Update text",
        what: "Replaces the old line.",
        why: "Changes the stored value.",
        details: [],
        risks: [],
      },
    });
    const codex = await fakeCodex(repo, {
      change: complete.change,
      files: Object.entries(complete.files).map(([path, note]) => ({
        path,
        ...note,
      })),
    });

    const result = run(repo, [
      "--range",
      "HEAD~1..HEAD",
      "--codex-bin",
      codex.bin,
      "--summaries",
      summaries,
      "--output",
      output,
    ]);
    assert.equal(result.status, 0, result.stderr);

    const writtenNotes = JSON.parse(await readFile(summaries, "utf8"));
    assert.deepEqual(
      { change: writtenNotes.change, files: writtenNotes.files },
      complete,
    );
    assert.match(writtenNotes.meta.reviewFingerprint, /^[a-f0-9]{64}$/);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("regenerates notes only for changed and added files", async () => {
  const repo = await makeRepo();
  const summaries = join(repo, "notes.json");
  const output = join(repo, "diff-data.json");
  const base = git(repo, "rev-parse", "HEAD~1");

  try {
    const codex = await recordingCodex(repo);
    const args = [
      "--base",
      base,
      "--head",
      "HEAD",
      "--codex-bin",
      codex.bin,
      "--summaries",
      summaries,
      "--output",
      output,
    ];

    const first = run(repo, args);
    assert.equal(first.status, 0, first.stderr);

    await writeFile(join(repo, "changed.txt"), "after again\n");
    await writeFile(join(repo, "new.txt"), "another file\n");
    git(repo, "add", "changed.txt", "new.txt");
    git(repo, "commit", "-qm", "change two paths");

    const second = run(repo, args);
    assert.equal(second.status, 0, second.stderr);

    assert.deepEqual(await recordedCalls(codex.calls), [
      { files: ["added.txt", "changed.txt"], existing: [] },
      { files: [], existing: ["added.txt", "changed.txt"] },
      {
        files: ["changed.txt", "new.txt"],
        existing: ["added.txt"],
      },
      {
        files: [],
        existing: ["added.txt", "changed.txt", "new.txt"],
      },
    ]);

    const writtenNotes = JSON.parse(await readFile(summaries, "utf8"));
    assert.equal(writtenNotes.change.title, "Change note 4");
    assert.equal(writtenNotes.files["added.txt"].title, "Note 1 for added.txt");
    assert.equal(
      writtenNotes.files["changed.txt"].title,
      "Note 3 for changed.txt",
    );
    assert.equal(writtenNotes.files["new.txt"].title, "Note 3 for new.txt");
    assert.deepEqual(
      Object.keys(writtenNotes.meta.fileFingerprints).sort(),
      ["added.txt", "changed.txt", "new.txt"],
    );
    assert.ok(
      Object.values(writtenNotes.meta.fileFingerprints).every((fingerprint) =>
        /^[a-f0-9]{64}$/.test(fingerprint),
      ),
    );

    const third = run(repo, args);
    assert.equal(third.status, 0, third.stderr);
    assert.match(third.stdout, /No file summaries changed/);
    assert.equal((await recordedCalls(codex.calls)).length, 4);

    const forced = run(repo, [...args, "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    assert.deepEqual((await recordedCalls(codex.calls)).at(-2), {
      files: ["added.txt", "changed.txt", "new.txt"],
      existing: [],
    });

    const refreshedNotes = JSON.parse(await readFile(summaries, "utf8"));
    assert.equal(refreshedNotes.change.title, "Change note 6");
    assert.equal(
      refreshedNotes.files["added.txt"].title,
      "Note 5 for added.txt",
    );

    const snapshot = JSON.parse(await readFile(output, "utf8"));
    assert.equal(snapshot.notes.complete, true);
    assert.ok(snapshot.files.every((file) => file.noteReady));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("drops removed files without regenerating unchanged file notes", async () => {
  const repo = await makeRepo();
  const summaries = join(repo, "notes.json");
  const output = join(repo, "diff-data.json");
  const base = git(repo, "rev-parse", "HEAD~1");

  try {
    const codex = await recordingCodex(repo);
    const args = [
      "--base",
      base,
      "--head",
      "HEAD",
      "--codex-bin",
      codex.bin,
      "--summaries",
      summaries,
      "--output",
      output,
    ];

    const first = run(repo, args);
    assert.equal(first.status, 0, first.stderr);

    git(repo, "rm", "-q", "added.txt");
    git(repo, "commit", "-qm", "remove added path");

    const second = run(repo, args);
    assert.equal(second.status, 0, second.stderr);

    assert.deepEqual(await recordedCalls(codex.calls), [
      { files: ["added.txt", "changed.txt"], existing: [] },
      { files: [], existing: ["added.txt", "changed.txt"] },
      { files: [], existing: ["changed.txt"] },
    ]);

    const writtenNotes = JSON.parse(await readFile(summaries, "utf8"));
    assert.equal(writtenNotes.change.title, "Change note 3");
    assert.deepEqual(Object.keys(writtenNotes.files), ["changed.txt"]);
    assert.equal(
      writtenNotes.files["changed.txt"].title,
      "Note 1 for changed.txt",
    );
    assert.deepEqual(
      Object.keys(writtenNotes.meta.fileFingerprints),
      ["changed.txt"],
    );

    const snapshot = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(
      snapshot.files.map((file) => file.path),
      ["changed.txt"],
    );
    assert.equal(snapshot.notes.complete, true);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
