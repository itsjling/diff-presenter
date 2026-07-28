import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const repo = await mkdtemp(join(tmpdir(), "beautiful-diffs-summaries-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "diff-presenter@example.test");
  git(repo, "config", "user.name", "Diff Presenter");
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

function run(repo, args) {
  return spawnSync(process.execPath, [script, "--repo", repo, ...args], {
    encoding: "utf8",
  });
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

test("does not write partial notes when Codex misses a changed file", async () => {
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
    await assert.rejects(readFile(summaries, "utf8"));
  } finally {
    await rm(repo, { recursive: true, force: true });
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
