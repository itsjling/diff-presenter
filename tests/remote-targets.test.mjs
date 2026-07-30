import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("../scripts/build-diff-data.mjs", import.meta.url).pathname;

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function run(repo, args, options = {}) {
  return execFileSync(
    process.execPath,
    [script, "--repo", repo, ...args],
    { encoding: "utf8", stdio: "pipe", ...options },
  );
}

async function proxyRemote(fixture, remoteUrl) {
  const bin = join(fixture.root, "git-proxy");
  const proxy = join(bin, "git");
  await mkdir(bin);
  await writeFile(
    proxy,
    `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2).map((arg) =>
  arg === ${JSON.stringify(remoteUrl)}
    ? ${JSON.stringify(fixture.remote)}
    : arg
);
const result = spawnSync("git", args, {
  env: { ...process.env, PATH: process.env.DIFFSPLAIN_REAL_PATH },
  stdio: "inherit",
});
process.exit(result.status ?? 1);
`,
  );
  await chmod(proxy, 0o755);
  return {
    ...process.env,
    DIFFSPLAIN_REAL_PATH: process.env.PATH,
    PATH: `${bin}:${process.env.PATH}`,
  };
}

async function makeRemoteRepo() {
  const root = await mkdtemp(join(tmpdir(), "diffsplain-remote-"));
  await mkdir(join(root, "example"));
  const remote = join(root, "example", "diffsplain.git");
  const repo = join(root, "checkout");
  execFileSync("git", ["init", "--bare", "-q", remote]);
  execFileSync("git", ["clone", "-q", remote, repo]);
  git(repo, "config", "user.email", "diffsplain@example.test");
  git(repo, "config", "user.name", "Diffsplain");
  git(repo, "config", "commit.gpgsign", "false");

  await writeFile(join(repo, "base.txt"), "base\n");
  git(repo, "add", "base.txt");
  git(repo, "commit", "-qm", "base");
  git(repo, "branch", "-M", "main");
  git(repo, "push", "-qu", "origin", "main");
  execFileSync("git", ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);
  const baseOid = git(repo, "rev-parse", "HEAD");

  git(repo, "switch", "-qc", "feature");
  await writeFile(join(repo, "feature.txt"), "feature work\n");
  git(repo, "add", "feature.txt");
  git(repo, "commit", "-qm", "feature");
  const featureOid = git(repo, "rev-parse", "HEAD");
  git(repo, "push", "-qu", "origin", "feature");

  git(repo, "switch", "-q", "main");
  await writeFile(join(repo, "main.txt"), "main work\n");
  git(repo, "add", "main.txt");
  git(repo, "commit", "-qm", "main");
  git(repo, "push", "-q", "origin", "main");
  const mainOid = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", "-D", "feature");

  return { root, remote, repo, baseOid, featureOid, mainOid };
}

function checkoutState(repo) {
  const fetchHead = join(repo, ".git", "FETCH_HEAD");
  return {
    head: git(repo, "rev-parse", "HEAD"),
    branch: git(repo, "branch", "--show-current"),
    status: git(repo, "status", "--porcelain=v1"),
    index: git(repo, "ls-files", "--stage"),
    refs: git(repo, "for-each-ref", "--format=%(refname) %(objectname)"),
    fetchHead: existsSync(fetchHead) ? readFileSync(fetchHead, "utf8") : null,
  };
}

test("builds a remote branch range without changing the checkout", async () => {
  const fixture = await makeRemoteRepo();
  const output = join(fixture.root, "branch.json");
  const cache = join(fixture.root, "cache");
  const before = checkoutState(fixture.repo);

  try {
    run(fixture.repo, [
      "--branch",
      "feature",
      "--cache-dir",
      cache,
      "--output",
      output,
    ]);
    const payload = JSON.parse(await readFile(output, "utf8"));

    assert.deepEqual(payload.files.map((file) => file.path), ["feature.txt"]);
    assert.equal(payload.repo.base, fixture.baseOid);
    assert.equal(payload.repo.head, fixture.featureOid);
    assert.equal(payload.repo.branch, "feature");
    assert.equal(payload.repo.remote, "origin");
    assert.equal(payload.repo.baseBranch, "main");
    assert.deepEqual(checkoutState(fixture.repo), before);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("builds the current checkout against the default branch", async () => {
  const fixture = await makeRemoteRepo();
  const output = join(fixture.root, "checkout.json");

  try {
    git(fixture.repo, "switch", "-qc", "local-feature");
    await writeFile(join(fixture.repo, "committed.txt"), "committed work\n");
    git(fixture.repo, "add", "committed.txt");
    git(fixture.repo, "commit", "-qm", "local feature");
    await writeFile(join(fixture.repo, "working.txt"), "working tree work\n");

    run(fixture.repo, ["--checkout", "--output", output]);
    const payload = JSON.parse(await readFile(output, "utf8"));

    assert.deepEqual(
      payload.files.map((file) => file.path),
      ["committed.txt", "working.txt"],
    );
    assert.equal(payload.repo.branch, "local-feature");
    assert.equal(payload.repo.baseBranch, "main");
    assert.equal(payload.repo.target.kind, "checkout");
    assert.equal(payload.repo.target.base.oid, fixture.mainOid);
    assert.equal(
      payload.change.title,
      "Changes on local-feature since main",
    );
    assert.equal(
      payload.change.summary,
      "Shows changes in the current checkout since it split from main, including any uncommitted work.",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("names worktree-only checkout changes without comparing a branch to itself", async () => {
  const fixture = await makeRemoteRepo();
  const output = join(fixture.root, "checkout-worktree.json");

  try {
    await writeFile(join(fixture.repo, "working.txt"), "working tree work\n");
    const githubRemote = "https://github.com/example/diffsplain.git";
    const env = await proxyRemote(fixture, githubRemote);
    git(
      fixture.repo,
      "remote",
      "set-url",
      "origin",
      githubRemote,
    );

    run(fixture.repo, ["--checkout", "--output", output], { env });
    const payload = JSON.parse(await readFile(output, "utf8"));

    assert.equal(payload.repo.base, payload.repo.head);
    assert.equal(payload.repo.branch, "main");
    assert.equal(payload.change.title, "Uncommitted changes on main");
    assert.equal(
      payload.change.summary,
      "Shows staged, unstaged, and untracked changes in the current checkout.",
    );
    assert.ok(
      payload.files.every((file) => file.comparisonUrl === undefined),
      "uncommitted work must not link to a commit-only comparison",
    );

    git(fixture.repo, "add", "working.txt");
    git(fixture.repo, "commit", "-qm", "local main work");

    run(fixture.repo, ["--checkout", "--output", output], { env });
    const committed = JSON.parse(await readFile(output, "utf8"));

    assert.notEqual(committed.repo.base, committed.repo.head);
    assert.equal(committed.change.title, "Local changes on main");
    assert.ok(
      committed.files.every((file) => file.comparisonUrl === undefined),
      "local-only commits must not link to a remote comparison",
    );

    git(fixture.repo, "remote", "set-url", "origin", fixture.remote);
    git(fixture.repo, "push", "-q", "origin", "HEAD:refs/heads/local-main");
    git(fixture.repo, "remote", "set-url", "origin", githubRemote);
    run(fixture.repo, ["--checkout", "--output", output], { env });
    const pushed = JSON.parse(await readFile(output, "utf8"));

    assert.match(
      pushed.files[0].comparisonUrl,
      /^https:\/\/github\.com\/example\/diffsplain\/compare\//,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("builds a remote repo target without a local checkout", async () => {
  const fixture = await makeRemoteRepo();
  const output = join(fixture.root, "remote-only.json");
  const cache = join(fixture.root, "remote-only-cache");

  try {
    execFileSync(
      process.execPath,
      [
        script,
        "--repo",
        fixture.root,
        "--remote",
        fixture.remote,
        "--branch",
        "feature",
        "--cache-dir",
        cache,
        "--output",
        output,
      ],
      { encoding: "utf8", stdio: "pipe" },
    );
    const payload = JSON.parse(await readFile(output, "utf8"));

    assert.deepEqual(payload.files.map((file) => file.path), ["feature.txt"]);
    assert.equal(payload.repo.root, fixture.remote);
    assert.equal(payload.repo.baseBranch, "main");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("renders uncommon range entries with the right content and GitHub links", async () => {
  const fixture = await makeRemoteRepo();
  const output = join(fixture.root, "uncommon-range.json");

  try {
    await writeFile(join(fixture.repo, "deleted.txt"), "remove me\n");
    await writeFile(join(fixture.repo, "moved-from.txt"), "move me\n");
    await writeFile(join(fixture.repo, "changed.bin"), Buffer.from([0, 1]));
    await writeFile(
      join(fixture.repo, "long.txt"),
      Array.from({ length: 240 }, (_, index) => `before ${index}\n`).join(""),
    );
    git(fixture.repo, "add", ".");
    git(fixture.repo, "commit", "-qm", "uncommon base");
    const base = git(fixture.repo, "rev-parse", "HEAD");

    await writeFile(join(fixture.repo, "changed.bin"), Buffer.from([0, 2]));
    await writeFile(join(fixture.repo, "added.bin"), Buffer.from([0, 4]));
    await rm(join(fixture.repo, "deleted.txt"));
    git(fixture.repo, "mv", "moved-from.txt", "moved-to.txt");
    await writeFile(
      join(fixture.repo, "long.txt"),
      Array.from({ length: 240 }, (_, index) => `after ${index}\n`).join(""),
    );
    git(fixture.repo, "add", ".");
    git(fixture.repo, "commit", "-qm", "uncommon changes");
    const head = git(fixture.repo, "rev-parse", "HEAD");
    const githubRemote = "https://github.com/example/diffsplain.git";
    const env = await proxyRemote(fixture, githubRemote);
    git(fixture.repo, "remote", "set-url", "origin", githubRemote);
    const beforeLocalOnly = checkoutState(fixture.repo);

    run(
      fixture.repo,
      ["--base", base, "--head", head, "--output", output],
      { env },
    );
    const localOnly = JSON.parse(await readFile(output, "utf8"));

    assert.ok(
      localOnly.files.every((file) => file.comparisonUrl === undefined),
      "local-only ranges must not link to a remote comparison",
    );
    assert.deepEqual(checkoutState(fixture.repo), beforeLocalOnly);

    git(fixture.repo, "remote", "set-url", "origin", fixture.remote);
    git(fixture.repo, "push", "-q", "origin", "HEAD:refs/heads/uncommon");
    git(fixture.repo, "remote", "set-url", "origin", githubRemote);
    const before = checkoutState(fixture.repo);

    run(
      fixture.repo,
      ["--base", base, "--head", head, "--output", output],
      { env },
    );
    const payload = JSON.parse(await readFile(output, "utf8"));
    const files = Object.fromEntries(payload.files.map((file) => [file.path, file]));
    const source = (ref, path) =>
      `https://github.com/example/diffsplain/blob/${ref}/${path}`;
    const comparison = `https://github.com/example/diffsplain/compare/${base}...${head}`;

    assert.deepEqual(
      payload.files.map((file) => file.path),
      ["added.bin", "changed.bin", "deleted.txt", "long.txt", "moved-to.txt"],
    );
    assert.equal(files["added.bin"].status, "binary");
    assert.equal(files["added.bin"].isBinary, true);
    assert.equal(files["added.bin"].patch, "");
    assert.equal(files["added.bin"].sourceUrl, source(head, "added.bin"));
    assert.equal(files["added.bin"].comparisonUrl, comparison);
    assert.equal(files["changed.bin"].status, "binary");
    assert.equal(files["changed.bin"].isBinary, true);
    assert.equal(files["changed.bin"].patch, "");
    assert.equal(files["changed.bin"].sourceUrl, source(head, "changed.bin"));
    assert.equal(files["changed.bin"].comparisonUrl, comparison);
    assert.equal(files["deleted.txt"].status, "deleted");
    assert.equal(files["deleted.txt"].isBinary, false);
    assert.match(files["deleted.txt"].patch, /-remove me/);
    assert.equal(files["deleted.txt"].sourceUrl, source(base, "deleted.txt"));
    assert.equal(files["deleted.txt"].comparisonUrl, comparison);
    assert.equal(files["moved-to.txt"].status, "renamed");
    assert.equal(files["moved-to.txt"].oldPath, "moved-from.txt");
    assert.match(files["moved-to.txt"].patch, /similarity index 100%/);
    assert.equal(files["moved-to.txt"].sourceUrl, source(head, "moved-to.txt"));
    assert.equal(files["moved-to.txt"].comparisonUrl, comparison);
    assert.equal(files["long.txt"].status, "modified");
    assert.equal(files["long.txt"].isBinary, false);
    assert.equal(files["long.txt"].isTruncated, true);
    assert.ok(files["long.txt"].snippet.split("\n").length <= 180);
    assert.match(files["long.txt"].snippet, /^@@ /m);
    assert.equal(files["long.txt"].sourceUrl, source(head, "long.txt"));
    assert.equal(files["long.txt"].comparisonUrl, comparison);
    assert.deepEqual(checkoutState(fixture.repo), before);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("keeps links out of worktree entries and leaves the checkout untouched", async () => {
  const fixture = await makeRemoteRepo();
  const output = join(fixture.root, "uncommon-worktree.json");

  try {
    await writeFile(join(fixture.repo, "worktree.bin"), Buffer.from([0, 1]));
    const before = checkoutState(fixture.repo);

    run(fixture.repo, ["--worktree", "--output", output]);
    const payload = JSON.parse(await readFile(output, "utf8"));
    const [file] = payload.files;

    assert.equal(file.path, "worktree.bin");
    assert.equal(file.status, "binary");
    assert.equal(file.isBinary, true);
    assert.equal(file.patch, "");
    assert.equal(file.sourceUrl, undefined);
    assert.equal(file.comparisonUrl, undefined);
    assert.deepEqual(checkoutState(fixture.repo), before);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("builds a pull request range through gh without changing the checkout", async () => {
  const fixture = await makeRemoteRepo();
  const bin = join(fixture.root, "bin");
  const gh = join(bin, "gh");
  const output = join(fixture.root, "pr.json");
  const cache = join(fixture.root, "cache");
  const before = checkoutState(fixture.repo);

  try {
    await mkdir(bin);
    await writeFile(
      gh,
      `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({
        number: 7,
        title: "Remote feature",
        url: "https://github.com/example/project/pull/7",
        baseRefName: "main",
        baseRefOid: fixture.mainOid,
        headRefName: "feature",
        headRefOid: fixture.featureOid,
      })}'\n`,
    );
    await chmod(gh, 0o755);
    execFileSync("git", ["--git-dir", fixture.remote, "update-ref", "refs/pull/7/head", fixture.featureOid]);

    run(
      fixture.repo,
      ["--pr", "7", "--cache-dir", cache, "--output", output],
      {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      },
    );
    const payload = JSON.parse(await readFile(output, "utf8"));

    assert.deepEqual(payload.files.map((file) => file.path), ["feature.txt"]);
    assert.equal(payload.repo.base, fixture.baseOid);
    assert.equal(payload.repo.head, fixture.featureOid);
    assert.equal(payload.repo.remote, "origin");
    assert.equal(payload.change.number, 7);
    assert.equal(payload.change.title, "Remote feature");
    assert.equal(payload.change.url, "https://github.com/example/project/pull/7");
    assert.deepEqual(checkoutState(fixture.repo), before);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects conflicting remote target flags", async () => {
  const fixture = await makeRemoteRepo();

  try {
    const result = spawnSync(
      process.execPath,
      [script, "--repo", fixture.repo, "--branch", "feature", "--pr", "7"],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--branch.*--pr|--pr.*--branch/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
