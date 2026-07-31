import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { chromium } from "@playwright/test";

export const browserRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function unusedPort() {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  probe.close();
  await once(probe, "close");
  return port;
}

export function parsedViteOutput(outputText) {
  const text = stripVTControlCharacters(outputText);
  return {
    text,
    url: text.match(/Local:\s+(http:\/\/[^\s]+)/)?.[1],
  };
}

export async function startViteServer({ cwd = browserRoot, env = {} } = {}) {
  const port = await unusedPort();
  return new Promise((resolveServer, rejectServer) => {
    const vite = resolve(browserRoot, "node_modules/vite/bin/vite.js");
    const child = spawn(
      process.execPath,
      [
        vite,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
        "--force",
      ],
      {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let outputText = "";
    let log = "";
    let ready = false;

    const onOutput = (chunk) => {
      outputText += chunk.toString();
      const parsed = parsedViteOutput(outputText);
      log = parsed.text;
      if (!parsed.url || ready) return;
      ready = true;
      resolveServer({
        log: () => log,
        stop: async () => {
          if (child.exitCode !== null) return;
          child.kill("SIGTERM");
          await once(child, "exit");
        },
        url: parsed.url,
      });
    };

    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
    child.once("error", rejectServer);
    child.once("exit", (code) => {
      if (!ready) {
        rejectServer(new Error(`Vite stopped before it was ready (${code}).\n${log}`));
      }
    });
  });
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function requestPathname(request) {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

function isWithin(directory, file) {
  return file === directory || file.startsWith(`${directory}${sep}`);
}

function requestedFile(directory, request) {
  const pathname = requestPathname(request);
  if (pathname === null) return null;
  const file = resolve(
    directory,
    pathname === "/" ? "index.html" : `.${pathname}`,
  );
  return isWithin(directory, file) ? file : null;
}

function contentType(file) {
  return (
    contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream"
  );
}

async function serveStaticFile(directory, request, response) {
  const file = requestedFile(directory, request);
  if (!file) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": contentType(file),
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}

export async function startStaticServer(directory) {
  let log = "";
  const server = createHttpServer((request, response) => {
    serveStaticFile(directory, request, response).catch((error) => {
      log += `${error.stack ?? error.message}\n`;
      response.writeHead(500).end("Server error");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    log: () => log,
    stop: async () => {
      server.close();
      await once(server, "close");
    },
    url: `http://127.0.0.1:${port}/`,
  };
}

async function saveFailureEvidence(
  name,
  page,
  context,
  consoleErrors,
  serverLog,
) {
  const evidence = await mkdtemp(join(tmpdir(), "diffsplain-browser-failure-"));
  await chmod(evidence, 0o700);
  await Promise.all([
    page.screenshot({ path: join(evidence, "page.png"), fullPage: true }),
    context.tracing.stop({ path: join(evidence, "trace.zip") }),
    writeFile(
      join(evidence, "browser-errors.json"),
      JSON.stringify(consoleErrors, null, 2),
    ),
    writeFile(join(evidence, "server.log"), serverLog()),
  ]);
  return new Error(`${name} failed. Evidence: ${evidence}`);
}

export async function runInBrowser(
  name,
  options,
  journey,
  { ignoredConsoleError = () => false, serverLog = () => "" } = {},
) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const consoleErrors = [];
  let traceSaved = false;

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: false,
  });

  try {
    await journey(page, context);
    assert.deepEqual(consoleErrors.filter((message) => !ignoredConsoleError(message)), []);
  } catch (error) {
    const evidenceError = await saveFailureEvidence(
      name,
      page,
      context,
      consoleErrors,
      serverLog,
    );
    traceSaved = true;
    throw new Error(`${evidenceError.message} ${error.message}`, {
      cause: error,
    });
  } finally {
    if (!traceSaved) await context.tracing.stop();
    await context.close();
    await browser.close();
  }
}
