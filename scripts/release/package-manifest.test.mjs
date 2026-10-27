import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCandidate } from "./release-candidate.mjs";
import {
  createPackageManifest,
  stagePackage,
  validatePackageManifest,
  smokeChecks,
  safeRelative,
  digest,
} from "./package-manifest.mjs";
const sha = "a".repeat(40);
function fixture(t, channel = "stable") {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-package-manifest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidate = createCandidate({
    sha,
    repository: "owner/project",
    version: "0.6.94",
    channel,
    check: {
      runId: 12,
      runAttempt: 1,
      jobId: 34,
      url: "https://github.com/owner/project/actions/runs/12",
    },
  });
  const stamp = {
    schemaVersion: 1,
    buildId: "fixture",
    version: candidate.version,
    channel,
    mode: "release-candidate",
    repositoryId: "fixture",
    branch: "fixture",
    head: sha,
    sourceFingerprint: "b".repeat(64),
    capturedAt: Date.now(),
    dirtyPaths: [],
    includedSources: [],
    components: { web: "fixture", native: "fixture", host: "fixture" },
  };
  const files = {
    "build/build-info.json": JSON.stringify(stamp),
    "build/host-packages/win32-x64/version.json": JSON.stringify({
      version: candidate.version,
      target: "win32-x64",
      buildIdentity: stamp,
    }),
    "build/host-packages/win32-x64/node.exe": "node fixture",
    "build/host-packages/win32-x64/host.mjs": "host fixture",
    "build/host-packages/bycoda-host-win32-x64.zip": "host archive fixture",
    "target/release/bycoda.exe": "native fixture__TAURI_BUNDLE_TYPE_VAR_UNKend",
    [`target/release/bundle/nsis/bycoda_${candidate.version}_x64-setup.exe`]: "installer fixture",
    ...(channel === "stable"
      ? {
          [`target/release/bundle/nsis/bycoda_${candidate.version}_x64-setup.exe.sig`]:
            "Zml4dHVyZQ==",
        }
      : {}),
  };
  for (const [file, value] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), value);
  }
  const manifest = createPackageManifest({
    candidate,
    platform: "windows-x64",
    root,
    installerReader: () => [
      {
        target: "native/bycoda.exe",
        payload: Buffer.from("native fixture__TAURI_BUNDLE_TYPE_VAR_NSSend"),
      },
      {
        target: "native/host/bycoda-host-win32-x64.zip",
        payload: Buffer.from("host archive fixture"),
      },
      {
        target: "native/host/bycoda-host-win32-x64.zip.sha256",
        payload: Buffer.from(`${digest("host archive fixture")}  bycoda-host-win32-x64.zip\n`),
      },
    ],
  });
  return { root, manifest };
}
test("package manifests bind actual bytes, candidate identity and full smoke receipt", (t) => {
  const { root, manifest } = fixture(t);
  assert.equal(validatePackageManifest(manifest, root).source.sha, sha);
  assert.throws(() => validatePackageManifest(manifest, root, { requireSmoke: true }));
  manifest.smoke = {
    schemaVersion: 1,
    evidence: "packaged-native-smoke",
    status: "passed",
    source: { sha, candidateDigest: manifest.source.candidateDigest },
    version: manifest.version,
    platform: manifest.platform,
    artifactDigest: manifest.artifactDigest,
    buildId: manifest.buildIdentity.buildId,
    checks: Object.fromEntries(smokeChecks.map((key) => [key, true])),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  assert.equal(
    validatePackageManifest(manifest, root, { requireSmoke: true }).smoke.status,
    "passed",
  );
  for (const mutation of [
    { artifactDigest: "0".repeat(64) },
    { checks: { ...manifest.smoke.checks, historyRendered: false } },
    { source: { sha: "c".repeat(40) } },
  ])
    assert.throws(() =>
      validatePackageManifest({ ...manifest, smoke: { ...manifest.smoke, ...mutation } }, root, {
        requireSmoke: true,
      }),
    );
  const staged = path.join(root, "staged");
  stagePackage(manifest, root, staged);
  assert.throws(() => stagePackage(manifest, root, staged));
  writeFileSync(path.join(staged, manifest.components.launcher.path), "tampered");
  assert.throws(() => validatePackageManifest(manifest, staged));
});
test("preview bytes cannot masquerade as stable updater assets and unsafe paths are refused", (t) => {
  const { root, manifest } = fixture(t, "preview");
  assert.equal(manifest.channel, "preview");
  assert(!manifest.components.updaterSignature);
  for (const file of ["../escape", "/absolute", "C:/drive", "folder\\file", "folder/../file"])
    assert.throws(() => safeRelative(file));
  assert.throws(() =>
    validatePackageManifest({ ...manifest, files: [...manifest.files, manifest.files[0]] }, root),
  );
  const files = manifest.files.map((file, index) =>
    index === 0 ? { ...file, role: "updaterArchive" } : file,
  );
  assert.throws(() => validatePackageManifest({ ...manifest, files }, root));
});
