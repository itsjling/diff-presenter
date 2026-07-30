import { defineConfig } from "blume";

export default defineConfig({
  title: "Diffsplain",
  description:
    "Review Git diffs one file at a time, with a short coding agent note beside each patch.",
  content: {
    root: "content",
  },
  analytics: {
    posthog: {
      key: "phc_sBYbvzcu7jj5Qh6jr6sZyXmZXsQs6DcwRxkLCKExHmiF",
      host: "https://us.i.posthog.com",
    },
  },
  deployment: {
    base: "/diffsplain/docs",
    output: "static",
    site: "https://itsjling.github.io",
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
