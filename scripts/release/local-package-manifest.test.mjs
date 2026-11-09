import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizedWindowsBinaryHash,
  stageLocalPackage,
  validateLocalPackageManifest,
} from "./local-package-manifest.mjs";
import { digest, packageFile, validatePackageManifest } from "./package-manifest.mjs";
import { createCandidate } from "./release-candidate.mjs";
import { validatePackageSet } from "./publish-candidate.mjs";
test("local frozen dirty snapshots require explicit mode and cannot become release manifests", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-local-manifest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stamp = {
    schemaVersion: 1,
    buildId: "local-fixture",
    version: "0.6.94",
    channel: "local",
    mode: "snapshot",
    repositoryId: "fixture",
    branch: "main",
    head: "a".repeat(40),
    sourceFingerprint: "b".repeat(64),
    capturedAt: Date.now(),
    dirtyPaths: [{ path: "host/cli.ts", status: " M" }],
    includedSources: [],
    components: { web: "fixture", native: "fixture", host: "fixture" },
  };
  const executable = Buffer.from("fixture__TAURI_BUNDLE_TYPE_VAR_NSSnative");
  const hostVersion = JSON.stringify({
    version: stamp.version,
    target: "win32-x64",
    buildIdentity: stamp,
  });
  const original = {
    buildIdentity: stamp,
    binaryHash: normalizedWindowsBinaryHash(executable),
    appHashes: { "setup.exe": digest("installer") },
    hostHashes: {
      "host.mjs": digest("host"),
      "node.exe": digest("node"),
      "version.json": digest(hostVersion),
    },
    hostArchive: { name: "archive.zip", sha256: digest("archive") },
  };
  const bytes = Buffer.from(JSON.stringify(original));
  const contents = {
    "native/bycoda.exe": executable,
    "setup.exe": "installer",
    "archive.zip": "archive",
    "native/host/archive.zip": "archive",
    "native/host/archive.zip.sha256": `${digest("archive")}  archive.zip\n`,
    "host/node.exe": "node",
    "host/host.mjs": "host",
    "host/version.json": hostVersion,
    "local-updater-manifest.json": bytes,
  };
  const roles = {
    launcher: "native/bycoda.exe",
    installer: "setup.exe",
    hostArchive: "archive.zip",
    hostNode: "host/node.exe",
    hostEntry: "host/host.mjs",
    versionJson: "host/version.json",
    localManifest: "local-updater-manifest.json",
  };
  const files = [];
  for (const [role, file] of Object.entries(roles)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents[file]);
    files.push(packageFile(root, file, role));
  }
  for (const file of ["native/host/archive.zip", "native/host/archive.zip.sha256"]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), contents[file]);
    files.push(packageFile(root, file, "appPayload"));
  }
  const manifest = {
    schemaVersion: 1,
    kind: "local-frozen-package",
    evidence: "local-frozen-package",
    candidate: null,
    source: {
      sha: stamp.head,
      sourceFingerprint: stamp.sourceFingerprint,
      candidateDigest: null,
      localPackageDigest: digest(bytes),
    },
    version: stamp.version,
    platform: "windows-x64",
    buildIdentity: stamp,
    files,
    artifactDigest: digest(JSON.stringify(files)),
    components: Object.fromEntries(
      Object.entries(roles).map(([role, file]) => [
        role,
        files.find((entry) => entry.path === file),
      ]),
    ),
  };
  assert.throws(() => validateLocalPackageManifest(manifest, root));
  assert.throws(() => validatePackageManifest(manifest, root));
  const candidate = createCandidate({
    sha: stamp.head,
    repository: "owner/project",
    version: stamp.version,
    check: {
      runId: 1,
      runAttempt: 1,
      jobId: 2,
      url: "https://github.com/owner/project/actions/runs/1",
    },
  });
  const promoted = {
    ...manifest,
    candidate,
    source: {
      ...manifest.source,
      repository: candidate.repository,
      candidateDigest: candidate.receiptSha256,
    },
  };
  const publish = (value) =>
    validatePackageSet(candidate, [
      { root, manifest: value },
      { root, manifest: { platform: "macos-arm64" } },
    ]);
  assert.throws(() => publish(promoted), /Invalid package manifest/);
  assert.throws(
    () => publish({ ...promoted, kind: "desktop-package" }),
    /Invalid package manifest/,
  );
  assert.throws(
    () =>
      publish({
        ...promoted,
        kind: "desktop-package",
        evidence: undefined,
        source: {
          sha: stamp.head,
          repository: candidate.repository,
          candidateDigest: candidate.receiptSha256,
        },
        channel: candidate.channel,
        buildIdentity: { ...stamp, channel: candidate.channel },
      }),
    /Invalid package build stamp/,
  );
  assert.equal(
    validateLocalPackageManifest(manifest, root, { allowLocal: true }).source.sourceFingerprint,
    stamp.sourceFingerprint,
  );
  const destination = path.join(root, "staged");
  stageLocalPackage(manifest, root, destination, { allowLocal: true });
  assert.throws(() =>
    validateLocalPackageManifest(
      { ...manifest, source: { ...manifest.source, localPackageDigest: "0".repeat(64) } },
      destination,
      { allowLocal: true },
    ),
  );
  writeFileSync(path.join(destination, "host/host.mjs"), "tamper");
  assert.throws(() => validateLocalPackageManifest(manifest, destination, { allowLocal: true }));
  assert.throws(() => normalizedWindowsBinaryHash(Buffer.from("no marker")));
});
