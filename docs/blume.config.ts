import { defineConfig } from "blume";

export default defineConfig({
  title: "Diffsplain",
  description:
    "Review Git diffs one file at a time, with a short Codex note beside each patch.",
  content: {
    root: "content",
  },
  deployment: {
    output: "static",
  },
  github: {
    dir: "docs",
    owner: "itsjling",
    repo: "diffsplain",
  },
  navigation: {
    sidebar: ["/", "/cli", "/agent-notes", "/data", "/development"],
  },
  theme: {
    accent: "blue",
  },
});
