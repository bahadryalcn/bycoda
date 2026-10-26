import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureBuildIdentity,
  sourceIdentity,
  readBuildIdentity,
  parseBuildIdentity,
} from "./build-info.mjs";
import { buildStatus } from "./build-status.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "bycoda-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "pipe" }).toString().trim();
  git("init");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  await writeFile(join(root, ".gitignore"), "build/\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
  await writeFile(join(root, "source.txt"), "original\n");
  git("add", ".");
  git("commit", "-m", "Initial fixture");
  return { root, git };
}

test("frozen captures distinguish equal versions, retain dirty paths and reject drift/overwrite", async (t) => {
  const { root } = await fixture(t);
  const frozen = join(root, "build", "frozen");
  await mkdir(frozen, { recursive: true });
  for (const path of [".gitignore", "package.json", "source.txt"])
    await cp(join(root, path), join(frozen, path));
  const request = {
    sourceRoot: root,
    frozenRoot: frozen,
    buildId: "build-1",
    version: "1.2.3",
    channel: "local",
    mode: "debug",
  };
  const first = await captureBuildIdentity(request);
  assert.equal((await captureBuildIdentity(request)).capturedAt, first.capturedAt);
  assert.deepEqual(await readBuildIdentity(join(frozen, "build/build-info.json")), first);
  await writeFile(join(root, "source.txt"), "changed\n");
  await assert.rejects(captureBuildIdentity(request), /Source changed/);
  await cp(join(root, "source.txt"), join(frozen, "source.txt"));
  await assert.rejects(captureBuildIdentity({ ...request, buildId: "build-2" }), /immutable/);
  const identity = await sourceIdentity(root);
  assert.notEqual(identity.sourceFingerprint, first.sourceFingerprint);
  assert.deepEqual(identity.dirtyPaths, [{ path: "source.txt", status: " M" }]);
});

test("linked worktrees share repository identity and retain their own branch/source", async (t) => {
  const { root, git } = await fixture(t);
  const sibling = join(root, "build", "sibling");
  await mkdir(join(root, "build"), { recursive: true });
  git("worktree", "add", "-b", "sibling", sibling);
  const a = await sourceIdentity(root);
  const b = await sourceIdentity(sibling);
  assert.equal(a.repositoryId, b.repositoryId);
  assert.equal(b.branch, "sibling");
  await writeFile(join(sibling, "source.txt"), "worktree only");
  assert.notEqual((await sourceIdentity(sibling)).sourceFingerprint, a.sourceFingerprint);
  assert.equal(await readFile(join(root, "source.txt"), "utf8"), "original\n");
});

test("build status verifies installed binary, queries actual live host and never echoes secrets", async (t) => {
  const { root } = await fixture(t);
  const frozen = join(root, "build");
  const identity = await captureBuildIdentity({
    sourceRoot: root,
    frozenRoot: root,
    buildId: "build-1",
    version: "1.2.3",
    channel: "local",
    mode: "debug",
  });
  const hostDir = join(frozen, "fake-host");
  await mkdir(join(hostDir, "update-jobs"), { recursive: true });
  const binary = join(frozen, "fake-app");
  await writeFile(binary, "actual executable");
  const binaryHash = createHash("sha256").update("actual executable").digest("hex");
  await writeFile(
    join(hostDir, "update-jobs/app.json"),
    JSON.stringify({
      state: "installed",
      binaryPath: binary,
      binaryHash,
      binaryHashKind: "sha256",
      buildIdentity: identity,
      secret: "receipt-secret",
    }),
  );
  const secret = "s".repeat(43);
  let requests = 0;
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${secret}`);
    requests++;
    res.end(
      JSON.stringify({
        pid: process.pid,
        version: "1.2.3",
        buildIdentity: { ...identity, secret: "nested-secret" },
        secret: "response-secret",
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await writeFile(
    join(hostDir, "running.json"),
    JSON.stringify({ port: server.address().port, pid: process.pid, secret }),
  );
  const status = await buildStatus({ sourceRoot: root, hostDir, stateDir: frozen });
  assert.equal(requests, 1);
  assert.equal(status.installedApp.comparison, "exact");
  assert.equal(status.runningHost.comparison, "exact");
  for (const value of [
    secret,
    "receipt-secret",
    "nested-secret",
    "response-secret",
    "Authorization",
  ])
    assert.ok(!JSON.stringify(status).includes(value));
  await writeFile(binary, "replaced outside coordinator");
  const changed = await buildStatus({ sourceRoot: root, hostDir, stateDir: frozen });
  assert.equal(changed.installedApp.sourceIdentity, "source identity unknown");
  assert.ok(changed.elapsedMs < 5000);
});

test("unstamped host and malformed manifests remain unknown", async (t) => {
  const { root } = await fixture(t);
  const hostDir = join(root, "build", "fake-host");
  const status = await buildStatus({ sourceRoot: root, hostDir, stateDir: hostDir });
  assert.equal(status.installedApp.sourceIdentity, "source identity unknown");
  assert.equal(status.runningHost.sourceIdentity, "source identity unknown");
  assert.equal(parseBuildIdentity({ schemaVersion: 1, secret: "bad" }), null);
});

test("status bounds an unresponsive host and reports pending jobs without raw job data", async (t) => {
  const { root } = await fixture(t);
  const hostDir = join(root, "build", "host");
  await mkdir(join(hostDir, "update-jobs"), { recursive: true });
  const server = createServer(() => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  await writeFile(
    join(hostDir, "running.json"),
    JSON.stringify({ port: server.address().port, pid: process.pid, secret: "t".repeat(43) }),
  );
  await writeFile(
    join(hostDir, "update-jobs/host.json"),
    JSON.stringify({
      state: "waiting",
      pid: process.pid,
      id: "pending-build",
      launchKey: "never-print-job-secret",
    }),
  );
  await writeFile(
    join(hostDir, "update-jobs/app.json"),
    JSON.stringify({ state: "failed", id: "failed-build", error: "never-print-installer-output" }),
  );
  const status = await buildStatus({ sourceRoot: root, hostDir, stateDir: hostDir, timeoutMs: 80 });
  assert.ok(status.elapsedMs < 5000);
  assert.equal(status.runningHost.state, "unresponsive or stale");
  assert.deepEqual(status.pendingInstalls, [
    { component: "host", state: "waiting", buildId: "pending-build" },
  ]);
  assert.ok(!JSON.stringify(status).includes("never-print"));
});
