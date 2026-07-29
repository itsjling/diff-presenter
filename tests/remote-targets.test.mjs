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

async function makeRemoteRepo() {
  const root = await mkdtemp(join(tmpdir(), "diffsplain-remote-"));
  const remote = join(root, "origin.git");
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
