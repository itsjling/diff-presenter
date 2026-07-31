import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let fixtureDirectory;
let output;
let server;
let serverLog = "";
let serverOutput = "";
let serverUrl;

function parsedServerOutput(outputText) {
  const text = stripVTControlCharacters(outputText);
  return {
    text,
    url: text.match(/Local:\s+(http:\/\/[^\s]+)/)?.[1],
  };
}

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

function startServer() {
  return new Promise((resolveServer, rejectServer) => {
    const vite = resolve(root, "node_modules/vite/bin/vite.js");
    server = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", "0"], {
      cwd: root,
      env: {
        ...process.env,
        DIFFSPLAIN_LIVE_OUTPUT: output,
        FORCE_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const onOutput = (chunk) => {
      serverOutput += chunk.toString();
      const parsed = parsedServerOutput(serverOutput);
      serverLog = parsed.text;
      if (parsed.url) {
        serverUrl = parsed.url;
        resolveServer();
      }
    };
    server.stdout.on("data", onOutput);
    server.stderr.on("data", onOutput);
    server.once("error", rejectServer);
    server.once("exit", (code) => {
      rejectServer(new Error(`Vite stopped before it was ready (${code}).\n${serverLog}`));
    });
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

  assert.equal(parsedServerOutput(outputText).url, "http://127.0.0.1:4173/");
});

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await once(server, "exit");
}

async function runInBrowser(name, options, journey) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const consoleErrors = [];
  let traceSaved = false;
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

  try {
    await journey(page);
    assert.deepEqual(
      consoleErrors.filter((message) => !message.includes("status of 503")),
      [],
    );
  } catch (error) {
    const evidence = await mkdtemp(join(tmpdir(), "diffsplain-browser-failure-"));
    await chmod(evidence, 0o700);
    await Promise.all([
      page.screenshot({ path: join(evidence, "review.png"), fullPage: true }),
      context.tracing.stop({ path: join(evidence, "trace.zip") }),
      writeFile(join(evidence, "browser-errors.json"), JSON.stringify(consoleErrors, null, 2)),
      writeFile(join(evidence, "server.log"), serverLog),
    ]);
    traceSaved = true;
    throw new Error(`${name} failed: ${error.message}. Evidence: ${evidence}`, { cause: error });
  } finally {
    if (!traceSaved) await context.tracing.stop();
    await context.close();
    await browser.close();
  }
}

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
  await startServer();
});

after(async () => {
  await stopServer();
  if (fixtureDirectory && existsSync(fixtureDirectory)) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test("shows error, empty, binary, truncated, and refreshed review states on desktop", async () => {
  await runInBrowser("desktop review journey", { viewport: { width: 1280, height: 800 } }, async (page) => {
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
  await runInBrowser(
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
