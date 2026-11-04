import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { captureBuildIdentity } from "./build-info.mjs";
import { createCandidate } from "../release/release-candidate.mjs";
import {
  consumeCommonArtifact,
  stageCommonArtifact,
  validateCommonArtifact,
} from "./release-common.mjs";

async function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-common-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      windowsHide: true,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  git("init");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.autocrlf", "false");
  writeFileSync(path.join(root, ".gitignore"), "build/\ndist/\ntemp/\n");
  writeFileSync(path.join(root, "source.txt"), "original\n");
  git("add", ".");
  git("commit", "-m", "fixture");
  const candidate = createCandidate({
    sha: git("rev-parse", "HEAD"),
    repository: "owner/project",
    version: "1.2.3",
    check: {
      runId: 12,
      runAttempt: 1,
      jobId: 34,
      url: "https://github.com/owner/project/actions/runs/12",
    },
  });
  const identity = await captureBuildIdentity({
    sourceRoot: root,
    frozenRoot: root,
    buildId: `candidate-${candidate.receiptSha256.slice(0, 24)}`,
    version: candidate.version,
    channel: candidate.channel,
    mode: "release-candidate",
  });
  const files = {
    "dist/index.html": "main",
    "dist/quick-composer.html": "quick",
    "dist/voice-overlay.html": "voice",
    "dist/build-info.json": JSON.stringify(identity),
  };
  for (const name of [
    "host",
    "bycoda-host",
    "provider-guard",
    "host-notes-worker",
    "store-worker",
    "snapshot-worker",
    "workspace-cleanup-worker",
  ])
    files[`build/host/${name}.mjs`] = `// ${name}\n`;
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), bytes);
  }
  return { root, candidate, identity, artifact: path.join(root, "temp/common"), git };
}
test("portable artifact transfers exact embedded identity across normalized independent checkouts", async (t) => {
  const f = await fixture(t);
  await stageCommonArtifact(f.candidate, f.root, f.artifact);
  const destination = path.join(f.root, "temp/consumer");
  // Simulate a Windows machine configured to autocrlf=true: checkout override
  // must retain the producer's LF bytes, rather than silently normalizing hashes.
  f.git("-c", "core.autocrlf=false", "clone", "--no-checkout", f.root, destination);
  execFileSync("git", ["config", "core.autocrlf", "true"], { cwd: destination, windowsHide: true });
  execFileSync("git", ["-c", "core.autocrlf=false", "checkout", "--detach", f.candidate.sha], {
    cwd: destination,
    windowsHide: true,
    stdio: "pipe",
  });
  await consumeCommonArtifact(f.candidate, destination, f.artifact, true);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(destination, "build/build-info.json"), "utf8")),
    f.identity,
  );
  await consumeCommonArtifact(f.candidate, destination, f.artifact);
  writeFileSync(path.join(destination, "dist/index.html"), "tampered");
  await assert.rejects(
    consumeCommonArtifact(f.candidate, destination, f.artifact),
    /Consumed common output changed/,
  );
});
test("candidate mismatch, tampering and unlisted outputs fail closed", async (t) => {
  const f = await fixture(t);
  await stageCommonArtifact(f.candidate, f.root, f.artifact);
  const other = createCandidate({
    sha: f.candidate.sha,
    repository: "owner/project",
    version: "1.2.4",
    check: f.candidate.sourceCheck,
  });
  assert.throws(() => validateCommonArtifact(other, f.artifact), /Wrong common artifact candidate/);
  writeFileSync(path.join(f.artifact, "dist/extra.js"), "injected");
  assert.throws(() => validateCommonArtifact(f.candidate, f.artifact), /unlisted/);
  rmSync(path.join(f.artifact, "dist/extra.js"));
  writeFileSync(path.join(f.artifact, "build/host/host.mjs"), "tampered");
  assert.throws(() => validateCommonArtifact(f.candidate, f.artifact), /size differs|bytes differ/);
});
test("source edits after compilation cannot be staged or consumed", async (t) => {
  const f = await fixture(t);
  await stageCommonArtifact(f.candidate, f.root, f.artifact);
  writeFileSync(path.join(f.root, "source.txt"), "changed\n");
  await assert.rejects(
    consumeCommonArtifact(f.candidate, f.root, f.artifact, true),
    /source bytes differ/,
  );
  await assert.rejects(
    stageCommonArtifact(f.candidate, f.root, f.artifact + "-new"),
    /source bytes differ/,
  );
});
test("traversal and duplicate inventory entries cannot be consumed", async (t) => {
  const f = await fixture(t);
  await stageCommonArtifact(f.candidate, f.root, f.artifact);
  const file = path.join(f.artifact, "manifest.json"),
    manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.files.push({ ...manifest.files[0], path: "dist/../../source.txt" });
  writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => validateCommonArtifact(f.candidate, f.artifact), /Unsafe/);
  manifest.files.pop();
  manifest.files.push(manifest.files[0]);
  writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => validateCommonArtifact(f.candidate, f.artifact), /duplicate/);
});

test("linked output directories cannot escape the artifact inventory", async (t) => {
  const f = await fixture(t);
  await stageCommonArtifact(f.candidate, f.root, f.artifact);
  const external = path.join(f.root, "temp/external");
  mkdirSync(external);
  symlinkSync(external, path.join(f.artifact, "dist/linked"), "junction");
  assert.throws(() => validateCommonArtifact(f.candidate, f.artifact), /cannot contain links/);
});
