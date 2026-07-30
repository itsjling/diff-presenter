import react from "@vitejs/plugin-react";
import { readFileSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const demoDataPath = resolve(import.meta.dirname, "public/demo-diff-data.json");
const liveDataPath = process.env.DIFFSPLAIN_LIVE_OUTPUT;
const liveAckPath = process.env.DIFFSPLAIN_LIVE_ACK;

function acknowledgeLiveRead(path: string | undefined, version: unknown) {
  if (path && typeof version === "string") {
    writeFileSync(path, `${version}\n`);
  }
}

function liveDiffData(output: string, acknowledge?: string): Plugin {
  return {
    name: "diffsplain-live-data",
    configureServer(server) {
      const clients = new Set<import("node:http").ServerResponse>();
      const publish = () => {
        for (const response of clients) {
          response.write("event: update\ndata: {}\n\n");
        }
      };
      watchFile(output, { interval: 100 }, (current, previous) => {
        if (
          current.mtimeMs !== previous.mtimeMs ||
          current.size !== previous.size
        ) {
          publish();
        }
      });
      server.httpServer?.once("close", () => {
        unwatchFile(output);
        for (const response of clients) response.end();
        clients.clear();
      });

      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?", 1)[0];
        if (pathname === "/events") {
          response.writeHead(200, {
            "cache-control": "no-store",
            "content-type": "text/event-stream",
            connection: "keep-alive",
          });
          response.write("retry: 250\nevent: ready\ndata: {}\n\n");
          clients.add(response);
          request.once("close", () => clients.delete(response));
          return;
        }
        if (pathname !== "/diff-data.json") {
          next();
          return;
        }
        try {
          const snapshot = readFileSync(output, "utf8");
          const parsed = JSON.parse(snapshot) as { version?: unknown };
          acknowledgeLiveRead(acknowledge, parsed.version);
          response.writeHead(200, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(snapshot);
        } catch {
          response.writeHead(503, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ error: "Live snapshot is not ready." }));
        }
      });
    },
  };
}

function bundledDemoData(): Plugin {
  return {
    name: "diffsplain-bundled-demo",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?", 1)[0] !== "/diff-data.json") {
          next();
          return;
        }

        let fixture: string;
        try {
          fixture = readFileSync(demoDataPath, "utf8");
          JSON.parse(fixture);
        } catch {
          response.writeHead(500, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
            "x-diffsplain-demo": "true",
          });
          response.end(JSON.stringify({ error: "Bundled demo data is invalid." }));
          return;
        }

        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
          "x-diffsplain-demo": "true",
        });
        response.end(fixture);
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    liveDataPath
      ? liveDiffData(liveDataPath, liveAckPath)
      : bundledDemoData(),
  ],
  server: isCodexSeatbeltSandbox
    ? { watch: { useFsEvents: false, usePolling: true } }
    : undefined,
});
