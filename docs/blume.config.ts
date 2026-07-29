import { defineConfig } from "blume";

export default defineConfig({
  title: "Diff Presenter",
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
    repo: "diff-presenter",
  },
  navigation: {
    sidebar: ["/", "/cli", "/agent-notes", "/data", "/development"],
  },
  theme: {
    accent: "blue",
  },
});
