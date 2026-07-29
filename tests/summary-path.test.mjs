import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { summaryPath } from "../scripts/summary-path.mjs";

const projectRoot = "/tmp/diffsplain";
const callerDirectory = "/tmp";
const repo = "/tmp/repo";

function path(options = {}) {
  return summaryPath({
    projectRoot,
    callerDirectory,
    repo,
    ...options,
  });
}

test("keeps worktree notes beside the target repo", () => {
  assert.equal(path(), join(repo, ".diffsplain/summaries.json"));
  assert.equal(
    path({ explicit: "chosen.json" }),
    join(callerDirectory, "chosen.json"),
  );
});

test("keeps remote and range notes in target-specific cache files", () => {
  const pullRequest = path({ pr: "198", remote: "origin" });
  assert.equal(
    pullRequest,
    path({
      pr: "https://github.com/example/project/pull/198",
      remote: "origin",
    }),
  );
  assert.match(pullRequest, /\/\.cache\/summaries\/pr-[a-f0-9]{24}\.json$/);

  const branch = path({ branch: "feature", remote: "origin" });
  const otherBranch = path({ branch: "other", remote: "origin" });
  const checkout = path({ checkout: true, remote: "origin" });
  const range = path({ base: "main", head: "feature" });
  assert.notEqual(branch, otherBranch);
  assert.notEqual(branch, range);
  assert.notEqual(checkout, range);
  assert.match(branch, /\/\.cache\/summaries\/branch-[a-f0-9]{24}\.json$/);
  assert.match(checkout, /\/\.cache\/summaries\/checkout-[a-f0-9]{24}\.json$/);
  assert.match(range, /\/\.cache\/summaries\/range-[a-f0-9]{24}\.json$/);
});
