import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const demoDataPath = resolve(import.meta.dirname, "public/demo-diff-data.json");

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
  plugins: [react(), bundledDemoData()],
  server: isCodexSeatbeltSandbox
    ? { watch: { useFsEvents: false, usePolling: true } }
    : undefined,
});
