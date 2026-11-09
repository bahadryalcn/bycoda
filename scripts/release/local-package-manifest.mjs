/** Explicit local frozen-package proof. Never a CI/release candidate. */
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseBuildIdentity } from "../build/build-info.mjs";
import { normalizedWindowsBinaryHash, readWindowsInstaller } from "./windows-installer.mjs";
import { digest, packageFile, safeRelative } from "./package-manifest.mjs";
import { parseSha256Sum } from "./checksum.mjs";

const hashPattern = /^[a-f0-9]{64}$/;
export { normalizedWindowsBinaryHash } from "./windows-installer.mjs";
export function validateLocalPackageManifest(manifest, root, { allowLocal = false } = {}) {
  assert.equal(allowLocal, true, "Local frozen packages require explicit local acceptance");
  assert(
    manifest?.schemaVersion === 1 &&
      manifest.kind === "local-frozen-package" &&
      manifest.evidence === "local-frozen-package" &&
      manifest.candidate === null &&
      manifest.source?.candidateDigest === null &&
      hashPattern.test(manifest.source.localPackageDigest),
    "Not an isolated local frozen-package manifest",
  );
  const stamp = parseBuildIdentity(manifest.buildIdentity);
  assert(
    stamp &&
      /^[a-f0-9]{40}$/.test(stamp.head) &&
      hashPattern.test(stamp.sourceFingerprint) &&
      stamp.head === manifest.source.sha &&
      stamp.sourceFingerprint === manifest.source.sourceFingerprint &&
      stamp.version === manifest.version &&
      manifest.platform === "windows-x64",
    "Local source fingerprint/version/platform differs",
  );
  assert(
    Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 5000,
    "Invalid local file count",
  );
  let total = 0;
  const seen = new Set();
  for (const file of manifest.files) {
    const name = safeRelative(file.path).normalize("NFC").toLowerCase();
    assert(!seen.has(name), "Duplicate local package file");
    seen.add(name);
    assert.deepEqual(packageFile(root, file.path, file.role), file, "Local frozen bytes changed");
    total += file.bytes;
  }
  assert(
    total <= 2 * 1024 * 1024 * 1024 &&
      manifest.artifactDigest === digest(JSON.stringify(manifest.files)),
    "Local package digest differs",
  );
  for (const role of [
    "launcher",
    "installer",
    "hostArchive",
    "hostNode",
    "hostEntry",
    "versionJson",
    "localManifest",
  ])
    assert(
      manifest.files.some(
        (file) => JSON.stringify(file) === JSON.stringify(manifest.components?.[role]),
      ),
      `Missing local ${role}`,
    );
  const originalBytes = readFileSync(path.join(root, manifest.components.localManifest.path));
  assert.equal(
    digest(originalBytes),
    manifest.source.localPackageDigest,
    "Original updater manifest changed",
  );
  const original = JSON.parse(originalBytes.toString("utf8"));
  const archiveName = safeRelative(original.hostArchive?.name);
  const expectedPaths = [
    ...Object.keys(original.hostHashes ?? {}).map((file) => `host/${safeRelative(file)}`),
    "setup.exe",
    archiveName,
    "native/bycoda.exe",
    `native/host/${archiveName}`,
    `native/host/${archiveName}.sha256`,
    "local-updater-manifest.json",
  ].sort();
  assert.deepEqual(
    manifest.files.map((file) => file.path).sort(),
    expectedPaths,
    "Local payload is not the exact updater-owned file set",
  );
  assert.deepEqual(
    parseBuildIdentity(original.buildIdentity),
    stamp,
    "Local stamp differs from immutable updater manifest",
  );
  for (const [file, expected] of Object.entries(original.hostHashes ?? {}))
    assert.equal(
      packageFile(root, `host/${safeRelative(file)}`).sha256,
      expected,
      "Immutable updater Host hashes differ",
    );
  assert.equal(
    manifest.components.installer.sha256,
    original.appHashes?.["setup.exe"],
    "Local installer differs from updater receipt",
  );
  assert.equal(
    manifest.components.hostArchive.sha256,
    original.hostArchive?.sha256,
    "Local Host archive differs from updater receipt",
  );
  assert.equal(
    packageFile(root, `native/host/${archiveName}`).sha256,
    original.hostArchive.sha256,
    "Native resources contain another frozen Host archive",
  );
  assert.equal(
    parseSha256Sum(
      readFileSync(path.join(root, `native/host/${archiveName}.sha256`), "utf8"),
      archiveName,
    ),
    original.hostArchive.sha256,
    "Native Host checksum differs",
  );
  assert.equal(
    normalizedWindowsBinaryHash(readFileSync(path.join(root, manifest.components.launcher.path))),
    original.binaryHash,
    "Extracted native binary differs from frozen updater binary",
  );
  const hostVersion = JSON.parse(
    readFileSync(path.join(root, manifest.components.versionJson.path), "utf8"),
  );
  assert(
    hostVersion.version === stamp.version &&
      hostVersion.target === "win32-x64" &&
      hostVersion.buildIdentity?.sourceFingerprint === stamp.sourceFingerprint,
    "Frozen Host identity differs",
  );
  return manifest;
}
export function stageLocalPackage(manifest, root, destination, options = {}) {
  validateLocalPackageManifest(manifest, root, options);
  assert(
    !existsSync(path.join(destination, "manifest.json")),
    "Local package staging is immutable",
  );
  for (const file of manifest.files) {
    const output = path.join(destination, file.path);
    mkdirSync(path.dirname(output), { recursive: true });
    copyFileSync(path.join(root, file.path), output);
  }
  writeFileSync(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
}
export function adaptLocalWindowsPackage({ manifestFile, output, sevenZip = "7z" }) {
  assert(!existsSync(output), "Adapter destination must be new");
  const stat = lstatSync(manifestFile);
  assert(
    stat.isFile() && stat.size > 0 && stat.size <= 2 * 1024 * 1024,
    "Invalid updater manifest",
  );
  const bytes = readFileSync(manifestFile),
    original = JSON.parse(bytes.toString("utf8")),
    root = path.dirname(manifestFile);
  const stamp = parseBuildIdentity(original.buildIdentity);
  assert(
    original.platform === "win32-x64" &&
      stamp &&
      original.version === stamp.version &&
      original.identity?.productName === "bycoda" &&
      original.identity?.binaryName === "bycoda" &&
      hashPattern.test(original.binaryHash),
    "Expected immutable Windows app+Host updater package",
  );
  const sourceFiles = new Map();
  for (const [relative, expected] of Object.entries(original.hostHashes ?? {})) {
    const file = `host/${safeRelative(relative)}`;
    assert.equal(packageFile(root, file).sha256, expected, "Frozen Host payload changed");
    sourceFiles.set(file, "hostPayload");
  }
  assert(
    sourceFiles.size > 0 &&
      sourceFiles.size < 4900 &&
      Object.keys(original.appHashes ?? {}).join() === "setup.exe",
    "Expected full frozen Host plus one installer",
  );
  assert.equal(
    packageFile(root, "setup.exe").sha256,
    original.appHashes["setup.exe"],
    "Frozen installer changed",
  );
  sourceFiles.set("setup.exe", "installer");
  const archive = safeRelative(original.hostArchive?.name);
  assert.equal(
    packageFile(root, archive).sha256,
    original.hostArchive.sha256,
    "Frozen Host archive changed",
  );
  sourceFiles.set(archive, "hostArchive");
  const extracted = readWindowsInstaller(path.resolve(root, "setup.exe"), {
    archive,
    nativeHash: original.binaryHash,
    hostArchiveHash: original.hostArchive.sha256,
    sevenZip,
  });
  mkdirSync(output, { recursive: true });
  for (const [file] of sourceFiles) {
    const target = path.join(output, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, file), target);
  }
  for (const entry of extracted) {
    const target = path.join(output, entry.target);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.payload, { flag: "wx" });
    sourceFiles.set(entry.target, entry.target.endsWith("bycoda.exe") ? "launcher" : "appPayload");
  }
  writeFileSync(path.join(output, "local-updater-manifest.json"), bytes, { flag: "wx" });
  sourceFiles.set("local-updater-manifest.json", "localManifest");
  const components = {
    launcher: "native/bycoda.exe",
    installer: "setup.exe",
    hostArchive: archive,
    hostNode: "host/node.exe",
    hostEntry: "host/host.mjs",
    versionJson: "host/version.json",
    localManifest: "local-updater-manifest.json",
  };
  for (const [role, file] of Object.entries(components)) {
    assert(sourceFiles.has(file), `Frozen package is missing ${file}`);
    sourceFiles.set(file, role);
  }
  const files = [...sourceFiles]
    .map(([file, role]) => packageFile(output, file, role))
    .sort((a, b) => a.path.localeCompare(b.path));
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
    channel: stamp.channel,
    platform: "windows-x64",
    artifactDigest: digest(JSON.stringify(files)),
    buildIdentity: stamp,
    components: Object.fromEntries(
      Object.entries(components).map(([role, file]) => [
        role,
        files.find((entry) => entry.path === file),
      ]),
    ),
    files,
    smoke: null,
    scope:
      "Local immutable dirty-snapshot proof only; never source CI, signing, installation or publication acceptance.",
  };
  validateLocalPackageManifest(manifest, output, { allowLocal: true });
  writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [manifestFile, output] = process.argv.slice(2);
  assert(
    manifestFile && output,
    "Expected immutable updater manifest and new temp staging directory",
  );
  const local = path.relative(path.resolve("temp"), path.resolve(output));
  assert(
    local && !local.startsWith("..") && !path.isAbsolute(local),
    "Local adapter output must remain in this checkout's temp directory",
  );
  adaptLocalWindowsPackage({
    manifestFile: path.resolve(manifestFile),
    output: path.resolve(output),
    sevenZip: process.env.BYCODA_SEVEN_ZIP ?? "7z",
  });
}
