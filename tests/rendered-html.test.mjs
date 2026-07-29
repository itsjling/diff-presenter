import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Diff Presenter entry state", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Diff Presenter<\/title>/i);
  assert.match(html, /Preparing the changes\./);
  assert.match(html, /Waiting for the workspace snapshot/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships the ten-file todo-list demo", async () => {
  const [{ todoDemoFiles }, payloadText] = await Promise.all([
    import("../docs/todo-demo.js"),
    readFile(new URL("../public/demo-diff-data.json", import.meta.url), "utf8"),
  ]);
  const payload = JSON.parse(payloadText);

  assert.match(payload.version, /^[a-f0-9]{12}$/);
  assert.equal(payload.repo.name, "todo-list-demo");
  assert.equal(payload.change.number, 42);
  assert.equal(payload.files.length, 10);
  assert.deepEqual(payload.files, todoDemoFiles);
  assert.ok(
    payload.files.every((file) => {
      const lines = file.patch.split("\n");
      const hunkIndex = lines.findIndex((line) => line.startsWith("@@"));
      const hunk = lines[hunkIndex].match(
        /^@@ -\d+,(\d+) \+\d+,(\d+) @@/,
      );
      const additions = lines.filter(
        (line) => line.startsWith("+") && !line.startsWith("+++"),
      ).length;
      const deletions = lines.filter(
        (line) => line.startsWith("-") && !line.startsWith("---"),
      ).length;
      const context = lines
        .slice(hunkIndex + 1)
        .filter((line) => line.startsWith(" ")).length;
      return (
        hunk &&
        file.additions === additions &&
        file.deletions === deletions &&
        Number(hunk[1]) === context + deletions &&
        Number(hunk[2]) === context + additions
      );
    }),
  );
  assert.equal(
    payload.files.reduce((sum, file) => sum + file.additions, 0),
    190,
  );
  assert.equal(
    payload.files.reduce((sum, file) => sum + file.deletions, 0),
    21,
  );
  assert.equal(payload.files.filter((file) => file.isBinary).length, 0);
  assert.equal(payload.files.filter((file) => file.isTruncated).length, 0);
  assert.equal(new Set(payload.files.map((file) => file.path)).size, 10);
  assert.ok(
    payload.files.every(
      (file) =>
        file.summary?.title &&
        file.summary?.what &&
        file.summary?.why &&
        Array.isArray(file.summary.details) &&
        Array.isArray(file.summary.risks),
    ),
  );
});

test("keeps live review data out of built assets", async () => {
  await access(new URL("../dist/client/demo-diff-data.json", import.meta.url));
  await assert.rejects(
    access(new URL("../dist/client/diff-data.json", import.meta.url)),
    { code: "ENOENT" },
  );
});

test("makes the landing-page demo interactive", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
    readFile(new URL("../docs/script.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<script src="\.\/script\.js" type="module">/);
  assert.match(html, /data-demo-picker-trigger/);
  assert.match(html, /data-demo-prev/);
  assert.match(html, /data-demo-next/);
  assert.match(script, /import \{ todoDemoFiles \} from "\.\/todo-demo\.js"/);
  assert.match(script, /ArrowLeft/);
  assert.match(script, /ArrowRight/);
  assert.match(script, /metaKey/);
});

test("falls back to the bundled demo when no live snapshot exists", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /liveResponse\.status === 404/);
  assert.match(page, /fetch\("\/demo-diff-data\.json"\)/);
});

test("shows a content skeleton while the agent writes a file summary", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Writing summary of diff\.\.\./);
  assert.match(page, /className="note-skeleton"/);
  assert.doesNotMatch(page, /Writing this note|NOTE PROGRESS/);
  assert.doesNotMatch(page, /You can review any finished file now/);
  assert.match(styles, /@keyframes note-skeleton-shimmer/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("removes all starter preview code and metadata", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(page, /ArrowRight/);
  assert.match(page, /Cmd\+K|metaKey/);
  assert.match(page, /diff-data\.json/);
});

test("builds live data for tracked and untracked workspace files", async () => {
  const repo = await mkdtemp(join(tmpdir(), "diff-presenter-test-"));
  const output = join(repo, "snapshot.json");
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  try {
    git("init", "-q");
    git("config", "user.email", "diff-presenter@example.test");
    git("config", "user.name", "Diff Presenter");
    await writeFile(join(repo, "tracked.txt"), "before\n");
    git("add", "tracked.txt");
    git("commit", "-qm", "base");

    await writeFile(join(repo, "tracked.txt"), "after\n");
    await writeFile(join(repo, "new.txt"), "new line\n");
    await mkdir(join(repo, ".beautiful-diffs"));
    await writeFile(
      join(repo, ".beautiful-diffs/summaries.json"),
      JSON.stringify({
        change: {
          title: "Test change",
          summary: "Changes two text files.",
          why: "Covers the local data path.",
          highlights: [],
          risks: [],
        },
        files: {
          "tracked.txt": {
            title: "Tracked note",
            what: "Changes tracked text.",
            why: "Tests a normal diff.",
            details: [],
            risks: [],
          },
          "new.txt": {
            title: "New note",
            what: "Adds text.",
            why: "Tests an untracked file.",
            details: [],
            risks: [],
          },
        },
      }),
    );

    execFileSync(
      process.execPath,
      [
        new URL("../scripts/build-diff-data.mjs", import.meta.url).pathname,
        "--repo",
        repo,
        "--output",
        output,
      ],
      { stdio: "pipe" },
    );

    const first = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(
      first.files.map((file) => file.path),
      ["new.txt", "tracked.txt"],
    );
    assert.equal(first.files[0].status, "added");
    assert.match(first.files[0].patch, /new line/);
    assert.equal(first.files[0].summary.title, "New note");

    const oldVersion = first.version;
    const summaries = JSON.parse(
      await readFile(join(repo, ".beautiful-diffs/summaries.json"), "utf8"),
    );
    summaries.files["new.txt"].title = "Revised note";
    await writeFile(
      join(repo, ".beautiful-diffs/summaries.json"),
      JSON.stringify(summaries),
    );
    execFileSync(
      process.execPath,
      [
        new URL("../scripts/build-diff-data.mjs", import.meta.url).pathname,
        "--repo",
        repo,
        "--output",
        output,
      ],
      { stdio: "pipe" },
    );

    const second = JSON.parse(await readFile(output, "utf8"));
    assert.notEqual(second.version, oldVersion);
    assert.equal(second.files[0].summary.title, "Revised note");

    summaries.meta = { reviewFingerprint: "0".repeat(64) };
    await writeFile(
      join(repo, ".beautiful-diffs/summaries.json"),
      JSON.stringify(summaries),
    );
    execFileSync(
      process.execPath,
      [
        new URL("../scripts/build-diff-data.mjs", import.meta.url).pathname,
        "--repo",
        repo,
        "--output",
        output,
      ],
      { stdio: "pipe" },
    );

    const stale = JSON.parse(await readFile(output, "utf8"));
    assert.equal(stale.files[0].summary.title, "new.txt");
    assert.match(stale.files[0].summary.why, /--agent/);
    assert.equal(stale.notes.fresh, false);
    assert.equal(stale.notes.complete, false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("handles a Git workspace before its first commit", async () => {
  const repo = await mkdtemp(join(tmpdir(), "diff-presenter-new-repo-"));
  const output = join(repo, "snapshot.json");

  try {
    execFileSync("git", ["-C", repo, "init", "-q"]);
    await writeFile(join(repo, "first.txt"), "first change\n");
    execFileSync(
      process.execPath,
      [
        new URL("../scripts/build-diff-data.mjs", import.meta.url).pathname,
        "--repo",
        repo,
        "--output",
        output,
      ],
      { stdio: "pipe" },
    );

    const payload = JSON.parse(await readFile(output, "utf8"));
    assert.equal(payload.repo.head, "WORKTREE");
    assert.equal(payload.files.length, 1);
    assert.equal(payload.files[0].path, "first.txt");
    assert.equal(payload.files[0].status, "added");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
