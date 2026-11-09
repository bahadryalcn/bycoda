import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
function fixture(t, channel = "stable", { external = false, beforeCreate } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "bycoda-package-manifest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cargoTargetDir = external
    ? mkdtempSync(path.join(tmpdir(), "bycoda-package-target-"))
    : undefined;
  if (cargoTargetDir) t.after(() => rmSync(cargoTargetDir, { recursive: true, force: true }));
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
  const native = `native fixture${JSON.stringify(stamp)}__TAURI_BUNDLE_TYPE_VAR_UNKend`;
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
    "target/release/bycoda.exe": native,
    [`target/release/bundle/nsis/bycoda_${candidate.version}_x64-setup.exe`]: "installer fixture",
    ...(channel !== "nightly"
      ? {
          [`target/release/bundle/nsis/bycoda_${candidate.version}_x64-setup.exe.sig`]:
            "Zml4dHVyZQ==",
        }
      : {}),
  };
  for (const [file, value] of Object.entries(files)) {
    const output =
      cargoTargetDir && file.startsWith("target/")
        ? path.join(cargoTargetDir, file.slice("target/".length))
        : path.join(root, file);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, value);
  }
  beforeCreate?.({ root, cargoTargetDir, candidate, stamp });
  let reads = 0;
  const manifest = createPackageManifest({
    candidate,
    platform: "windows-x64",
    root,
    cargoTargetDir,
    installerReader: (installer, expected) => {
      reads += 1;
      assert.equal(readFileSync(installer, "utf8"), "installer fixture");
      assert.equal(expected.hostArchiveHash, digest("host archive fixture"));
      return [
        { target: "native/bycoda.exe", payload: Buffer.from(native.replace("_UNKend", "_NSSend")) },
        {
          target: "native/host/bycoda-host-win32-x64.zip",
          payload: Buffer.from("host archive fixture"),
        },
        {
          target: "native/host/bycoda-host-win32-x64.zip.sha256",
          payload: Buffer.from(`${digest("host archive fixture")}  bycoda-host-win32-x64.zip\n`),
        },
      ];
    },
  });
  assert.equal(reads, 1);
  return { root, manifest, cargoTargetDir };
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
test("signed preview packages bind their updater signature like stable", (t) => {
  const { root, manifest } = fixture(t, "preview");
  assert.equal(manifest.channel, "preview");
  assert.equal(
    manifest.components.updaterSignature.path,
    `${manifest.components.updaterArchive.path}.sig`,
  );
  validatePackageManifest(manifest, root);
  const files = manifest.files.filter((file) => file.role !== "updaterSignature");
  assert.throws(() => validatePackageManifest({ ...manifest, files }, root));
});

test("nightly bytes cannot masquerade as updater assets and unsafe paths are refused", (t) => {
  const { root, manifest } = fixture(t, "nightly");
  assert.equal(manifest.channel, "nightly");
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

test("an explicit external Cargo target selects only current identity-bound Windows outputs", (t) => {
  const { root, manifest, cargoTargetDir } = fixture(t, "stable", {
    external: true,
    beforeCreate: ({ cargoTargetDir }) => {
      // A persistent cache contains other versions and arbitrary files: neither is scanned.
      writeFileSync(
        path.join(cargoTargetDir, "release/bundle/nsis/bycoda_0.1.0_x64-setup.exe"),
        "stale installer",
      );
      writeFileSync(path.join(cargoTargetDir, "release/private-cache-file"), "not a package input");
    },
  });
  assert(!existsSync(path.join(root, "target")), "No source-checkout target was needed");
  assert.equal(
    manifest.components.buildNative.path,
    "build/package-payload/windows/cargo/release/bycoda.exe",
  );
  assert.match(
    manifest.components.installer.path,
    /cargo\/release\/bundle\/nsis\/bycoda_0\.6\.94_x64-setup\.exe$/,
  );
  assert.equal(
    manifest.components.updaterSignature.path,
    `${manifest.components.installer.path}.sig`,
  );
  assert.equal(manifest.windowsInstaller.evidence, "nsis-extracted-native");
  assert(
    manifest.files.every(
      (file) => !file.path.includes("private-cache-file") && !file.path.includes("0.1.0"),
    ),
  );
  assert.equal(validatePackageManifest(manifest, root).source.sha, sha);
  const staged = path.join(root, "verified-stage");
  stagePackage(manifest, root, staged);
  rmSync(cargoTargetDir, { recursive: true });
  assert.equal(validatePackageManifest(manifest, staged).artifactDigest, manifest.artifactDigest);
  assert.throws(() => validatePackageManifest(manifest, staged, { requireSmoke: true }), /smoke/);
});

test("external Cargo staging refuses stale native metadata, wrong source identity and links", (t) => {
  assert.throws(
    () =>
      fixture(t, "nightly", {
        external: true,
        beforeCreate: ({ cargoTargetDir, stamp }) =>
          writeFileSync(
            path.join(cargoTargetDir, "release/bycoda.exe"),
            `native fixture${JSON.stringify({ ...stamp, sourceFingerprint: "c".repeat(64) })}__TAURI_BUNDLE_TYPE_VAR_UNKend`,
          ),
      }),
    /exact frozen build identity/,
  );
  assert.throws(
    () =>
      fixture(t, "nightly", {
        external: true,
        beforeCreate: ({ root, stamp }) =>
          writeFileSync(
            path.join(root, "build/build-info.json"),
            JSON.stringify({ ...stamp, head: "c".repeat(40) }),
          ),
      }),
    /Frozen build identity differs/,
  );
  assert.throws(
    () =>
      fixture(t, "nightly", {
        external: true,
        beforeCreate: ({ root, stamp }) =>
          writeFileSync(
            path.join(root, "build/host-packages/win32-x64/version.json"),
            JSON.stringify({
              version: stamp.version,
              target: "win32-x64",
              buildIdentity: { ...stamp, sourceFingerprint: "c".repeat(64) },
            }),
          ),
      }),
    /Packaged Host identity differs/,
  );
  assert.throws(
    () =>
      fixture(t, "nightly", {
        external: true,
        beforeCreate: ({ cargoTargetDir }) => {
          const destination = path.join(cargoTargetDir, "release");
          const actual = path.join(cargoTargetDir, "actual-release");
          mkdirSync(actual);
          rmSync(destination, { recursive: true });
          symlinkSync(actual, destination, process.platform === "win32" ? "junction" : "dir");
        },
      }),
    /links or reparse points/,
  );
});

test("hosted defaults ignore ambient Cargo targets and explicit targets cannot read inside the checkout", (t) => {
  const previous = process.env.CARGO_TARGET_DIR;
  let current;
  try {
    process.env.CARGO_TARGET_DIR = "not-an-approved-target";
    current = fixture(t, "nightly");
  } finally {
    if (previous === undefined) delete process.env.CARGO_TARGET_DIR;
    else process.env.CARGO_TARGET_DIR = previous;
  }
  assert.equal(current.manifest.components.buildNative.path, "target/release/bycoda.exe");
  const input = {
    root: current.root,
    candidate: current.manifest.candidate,
    platform: "windows-x64",
  };
  assert.throws(
    () => createPackageManifest({ ...input, cargoTargetDir: "relative" }),
    /explicit absolute path/,
  );
  assert.throws(
    () => createPackageManifest({ ...input, cargoTargetDir: path.join(current.root, "target") }),
    /outside the candidate checkout/,
  );
  assert.throws(
    () =>
      createPackageManifest({
        ...input,
        cargoTargetDir: path.join(current.root, "target/release/bycoda.exe"),
      }),
    /not a regular file or directory/,
  );
  assert.throws(
    () =>
      createPackageManifest({ ...input, platform: "macos-arm64", cargoTargetDir: current.root }),
    /Windows-only/,
  );
});
