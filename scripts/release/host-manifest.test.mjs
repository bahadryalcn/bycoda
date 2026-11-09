import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCandidate } from "./release-candidate.mjs";
import { digest } from "./package-manifest.mjs";
import { hostTargets, stageHostPackages, validateHostManifest } from "./host-manifest.mjs";
test("all six standalone Host archives require exact source identity, checksum and immutable bytes", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-host-manifest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidate = createCandidate({
    sha: "a".repeat(40),
    repository: "owner/project",
    version: "0.6.94",
    check: {
      runId: 1,
      jobId: 2,
      runAttempt: 1,
      url: "https://github.com/owner/project/actions/runs/1",
    },
  });
  const stamp = {
    schemaVersion: 1,
    buildId: "fixture",
    version: candidate.version,
    channel: "stable",
    mode: "release-candidate",
    repositoryId: "fixture",
    branch: "fixture",
    head: candidate.sha,
    sourceFingerprint: "b".repeat(64),
    capturedAt: Date.now(),
    dirtyPaths: [],
    includedSources: [],
    components: { web: "fixture", native: "fixture", host: "fixture" },
  };
  mkdirSync(path.join(root, "build/host-packages"), { recursive: true });
  writeFileSync(path.join(root, "build/build-info.json"), JSON.stringify(stamp));
  for (const target of hostTargets) {
    const folder = path.join(root, "build/host-packages"),
      filename = `bycoda-host-${target}.${target.startsWith("win32-") ? "zip" : "tar.gz"}`;
    const bytes = Buffer.from(`fixture ${target}`);
    writeFileSync(path.join(folder, filename), bytes);
    writeFileSync(path.join(folder, `${filename}.sha256`), `${digest(bytes)}  ${filename}\n`);
    mkdirSync(path.join(folder, target));
    writeFileSync(
      path.join(folder, target, "version.json"),
      JSON.stringify({ version: candidate.version, target, buildIdentity: stamp }),
    );
  }
  const destination = path.join(root, "staged"),
    manifest = stageHostPackages({ candidate, root, destination });
  assert.equal(validateHostManifest(manifest, destination, candidate).packages.length, 6);
  assert.throws(() => stageHostPackages({ candidate, root, destination }));
  assert.throws(() =>
    validateHostManifest(
      { ...manifest, packages: manifest.packages.slice(1) },
      destination,
      candidate,
    ),
  );
  assert.throws(() =>
    validateHostManifest({ ...manifest, sourceSha: "c".repeat(40) }, destination, candidate),
  );
  writeFileSync(path.join(destination, manifest.packages[0].archive.path), "tampered");
  assert.throws(() => validateHostManifest(manifest, destination, candidate));
});
