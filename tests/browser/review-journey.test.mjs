import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

import {
  parsedViteOutput,
  runInBrowser,
  startViteServer,
} from "./browser-harness.mjs";

let fixtureDirectory;
let output;
let server;
let serverUrl;

function snapshot(version, files) {
  return {
    version,
    generatedAt: "2026-07-31T00:00:00.000Z",
    repo: {
      name: "browser-fixture",
      root: "/fixture/browser-fixture",
      base: "main",
      head: "fixture-head",
      target: { kind: "worktree" },
    },
    change: {
      title: `Fixture review ${version}`,
      summary: "A deterministic browser fixture.",
      why: "Browser checks need no local repository or account.",
      highlights: [],
      risks: [],
    },
    notes: {
      fresh: true,
      complete: true,
      status: "complete",
      completedFiles: files.length,
      totalFiles: files.length,
    },
    files,
  };
}

function textFile(path, title, { truncated = false } = {}) {
  const patch = [
    `diff --git a/${path} b/${path}`,
    "index 0000000..1111111 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-before",
    `+${title} full patch`,
  ].join("\n");
  return {
    path,
    status: "modified",
    additions: 1,
    deletions: 1,
    isBinary: false,
    isTruncated: truncated,
    totalDiffLines: truncated ? 2_048 : 7,
    patch,
    snippet: truncated
      ? `${patch.split("\n").slice(0, 4).join("\n")}\n… diff truncated; read the full diff.`
      : patch,
    summary: {
      title,
      what: `${title} explains the changed behavior.`,
      why: "The fixture proves that notes remain readable.",
      details: ["The mock provider emits deterministic review data."],
      risks: ["The fixture risk is intentionally public."],
    },
  };
}

function binaryFile(version) {
  return {
    path: "assets/logo.png",
    status: "binary",
    additions: 0,
    deletions: 0,
    isBinary: true,
    isTruncated: false,
    totalDiffLines: 0,
    patch: "Binary files differ",
    snippet: "Binary files differ",
    summary: {
      title: `Binary note ${version}`,
      what: "The binary file stays in the review.",
      why: "Reviewers still need the note for non-text files.",
      details: ["The image bytes are not included in the test fixture."],
      risks: [],
    },
  };
}

function fixture(version = "one") {
  const files = [
    textFile("src/todos.ts", "Explain saved todos"),
    textFile("src/long-list.ts", "Explain the full patch", { truncated: true }),
    binaryFile(version),
  ];
  if (version !== "one") files[1].summary.title = `Live review ${version}`;
  return snapshot(version, files);
}

async function writeSnapshot(value) {
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
}

function runReviewJourney(name, options, journey) {
  return runInBrowser(name, options, journey, {
    ignoredConsoleError: (message) => message.includes("status of 503"),
    serverLog: () => server.log(),
  });
}

test("parses Vite's URL when text and color codes cross output chunks", () => {
  let outputText = "";
  for (const chunk of [
    "\u001b[3",
    "2m  ➜  Loc",
    "al:\u001b[0",
    "m   http://127.0.0.1:4173/\n",
  ]) {
    outputText += chunk;
  }

  assert.equal(parsedViteOutput(outputText).url, "http://127.0.0.1:4173/");
});

async function selectFile(page, search) {
  await page.locator(".file-picker-trigger").click();
  await page.getByRole("dialog", { name: "Choose a changed file" }).waitFor();
  const input = page.getByRole("textbox", { name: "Filter changed files" });
  await input.fill(search);
  await page.getByRole("button", { name: new RegExp(search, "i") }).click();
}

before(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "diffsplain-browser-fixture-"));
  output = join(fixtureDirectory, "diff-data.json");
  server = await startViteServer({
    env: {
      DIFFSPLAIN_LIVE_OUTPUT: output,
      FORCE_COLOR: "1",
    },
  });
  serverUrl = server.url;
});

after(async () => {
  await server?.stop();
  if (fixtureDirectory && existsSync(fixtureDirectory)) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test("shows error, empty, binary, truncated, and refreshed review states on desktop", async () => {
  await runReviewJourney("desktop review journey", { viewport: { width: 1280, height: 800 } }, async (page) => {
    await page.goto(serverUrl);
    await page.getByText("Snapshot returned 503").waitFor();

    await writeSnapshot(snapshot("empty", []));
    await page.getByRole("heading", { name: "No changed files." }).waitFor();

    await writeSnapshot(fixture());
    await page.getByRole("heading", { name: "Explain saved todos" }).waitFor();
    await page.getByText("The fixture risk is intentionally public.").waitFor();

    await selectFile(page, "long-list");
    await page.getByRole("button", { name: "Read full diff" }).click();
    await page.getByText("Explain the full patch full patch").waitFor();

    await selectFile(page, "logo.png");
    await page.getByText("The file contents cannot appear as text.").waitFor();
    await page.getByRole("heading", { name: "Binary note one" }).waitFor();

    await writeSnapshot(fixture("two"));
    await page.getByRole("heading", { name: "Binary note two" }).waitFor();
  });
});

test("runs the full picker and refresh journey at the supported mobile viewport", async () => {
  await runReviewJourney(
    "mobile review journey",
    { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } },
    async (page) => {
      await writeSnapshot(fixture("mobile-one"));
      await page.goto(serverUrl);
      await page.getByRole("heading", { name: "Explain saved todos" }).waitFor();

      await selectFile(page, "long-list");
      await page.getByRole("heading", { name: "Live review mobile-one" }).waitFor();
      await page.getByRole("button", { name: "Read full diff" }).click();
      await page.getByText("Explain the full patch full patch").waitFor();
      await page.getByText("The fixture risk is intentionally public.").waitFor();

      await writeSnapshot(fixture("mobile-two"));
      await page.getByRole("heading", { name: "Live review mobile-two" }).waitFor();
    },
  );
});
