/** Immutable package bytes and smoke receipts; never launches or publishes. */
import assert from "node:assert/strict";
import { parseSha256Sum } from "./checksum.mjs";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateCandidate } from "./release-candidate.mjs";
import { parseBuildIdentity } from "../build/build-info.mjs";
import { readWindowsInstaller, normalizedWindowsBinaryHash } from "./windows-installer.mjs";

export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256 = /^[a-f0-9]{64}$/;
export const smokeChecks = [
  "artifactHashes",
  "embeddedNativeIdentity",
  "hostIdentity",
  "oldDatabaseMigrated",
  "savedSessionRead",
  "historyRendered",
];
export function safeRelative(file) {
  assert(
    typeof file === "string" &&
      file.length > 0 &&
      file.length < 1024 &&
      !/[\\:\0\r\n]/.test(file) &&
      !file.startsWith("/") &&
      file.split("/").every((part) => part && part !== "." && part !== ".."),
    "Unsafe artifact path",
  );
  return file;
}
export function packageFile(root, file, role = "payload") {
  safeRelative(file);
  const absolute = path.resolve(root, file);
  const actual = realpathSync(absolute);
  const relative = path.relative(realpathSync(root), actual);
  assert(!relative.startsWith("..") && !path.isAbsolute(relative), "Artifact escapes its root");
  const stat = lstatSync(absolute);
  assert(
    stat.isFile() && stat.size > 0 && stat.size <= 512 * 1024 * 1024,
    "Artifact must be a bounded regular file",
  );
  return { path: file, sha256: digest(readFileSync(absolute)), bytes: stat.size, role };
}
function walk(root, directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    assert(!entry.isSymbolicLink(), "Package payload may not contain symlinks");
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(root, file) : [file];
  });
}
const one = (files, description) => {
  assert.equal(files.length, 1, `Expected exactly one ${description}`);
  return files[0];
};
export function createPackageManifest({
  candidate,
  platform,
  root,
  installerReader = readWindowsInstaller,
}) {
  validateCandidate(candidate);
  assert(["windows-x64", "macos-arm64"].includes(platform), "Unsupported package platform");
  const windows = platform === "windows-x64";
  const base = windows ? "target/release" : "target/aarch64-apple-darwin/release";
  const hostTarget = windows ? "win32-x64" : "darwin-arm64";
  const hostFolder = `build/host-packages/${hostTarget}`;
  const rawLauncher = windows
    ? `${base}/bycoda.exe`
    : `${base}/bundle/macos/bycoda.app/Contents/MacOS/bycoda`;
  const installers = walk(root, `${base}/bundle/${windows ? "nsis" : "dmg"}`).filter((file) =>
    file.endsWith(windows ? ".exe" : ".dmg"),
  );
  const installer = one(installers, "installer");
  assert(
    path.basename(installer).includes(candidate.version),
    "Installer version differs from candidate",
  );
  const hostArchive = `build/host-packages/bycoda-host-${hostTarget}.${windows ? "zip" : "tar.gz"}`;
  let launcher = rawLauncher,
    windowsInstaller = null;
  const extractedFiles = [];
  if (windows) {
    const nativeHash = normalizedWindowsBinaryHash(readFileSync(path.join(root, rawLauncher)));
    const hostArchiveHash = packageFile(root, hostArchive).sha256;
    const members = installerReader(path.resolve(root, installer), {
      archive: path.basename(hostArchive),
      nativeHash,
      hostArchiveHash,
      sevenZip: process.env.BYCODA_SEVEN_ZIP ?? "7z",
    });
    for (const member of members) {
      const file = `build/package-payload/windows/${safeRelative(member.target)}`,
        output = path.join(root, file);
      mkdirSync(path.dirname(output), { recursive: true });
      if (existsSync(output))
        assert.equal(
          digest(readFileSync(output)),
          digest(member.payload),
          "Extracted installer staging is immutable",
        );
      else writeFileSync(output, member.payload, { flag: "wx" });
      extractedFiles.push(file);
    }
    launcher = "build/package-payload/windows/native/bycoda.exe";
    windowsInstaller = {
      evidence: "nsis-extracted-native",
      installerSha256: packageFile(root, installer).sha256,
      normalizedNativeSha256: nativeHash,
      hostArchiveSha256: hostArchiveHash,
    };
  }
  const components = {
    launcher,
    installer,
    hostArchive,
    hostNode: `${hostFolder}/${windows ? "node.exe" : "node"}`,
    hostEntry: `${hostFolder}/host.mjs`,
    versionJson: `${hostFolder}/version.json`,
    ...(windows ? { buildNative: rawLauncher } : {}),
  };
  const named = new Map(Object.entries(components).map(([role, file]) => [file, role]));
  named.set("build/build-info.json", "buildIdentity");
  for (const file of extractedFiles) if (!named.has(file)) named.set(file, "appPayload");
  for (const file of walk(root, hostFolder)) if (!named.has(file)) named.set(file, "hostPayload");
  if (!windows)
    for (const file of walk(root, `${base}/bundle/macos/bycoda.app`))
      if (!named.has(file)) named.set(file, "appPayload");
  if (candidate.channel === "stable") {
    const archive = windows
      ? installer
      : one(
          walk(root, `${base}/bundle/macos`).filter((file) => file.endsWith(".app.tar.gz")),
          "updater archive",
        );
    named.set(archive, "updaterArchive");
    named.set(`${archive}.sig`, "updaterSignature");
    components.updaterArchive = archive;
    components.updaterSignature = `${archive}.sig`;
  }
  const files = [...named]
    .map(([file, role]) => packageFile(root, file, role))
    .sort((a, b) => a.path.localeCompare(b.path));
  const buildIdentity = parseBuildIdentity(
    JSON.parse(readFileSync(path.join(root, "build/build-info.json"), "utf8")),
  );
  assert(
    buildIdentity &&
      buildIdentity.head === candidate.sha &&
      buildIdentity.version === candidate.version &&
      buildIdentity.channel === candidate.channel,
    "Frozen build identity differs from candidate",
  );
  const version = JSON.parse(readFileSync(path.join(root, components.versionJson), "utf8"));
  assert(
    version.version === candidate.version &&
      version.target === hostTarget &&
      version.buildIdentity?.sourceFingerprint === buildIdentity.sourceFingerprint,
    "Packaged Host identity differs",
  );
  return validatePackageManifest(
    {
      schemaVersion: 1,
      kind: "desktop-package",
      source: {
        sha: candidate.sha,
        repository: candidate.repository,
        candidateDigest: candidate.receiptSha256,
      },
      candidate,
      version: candidate.version,
      channel: candidate.channel,
      platform,
      windowsInstaller,
      artifactDigest: digest(JSON.stringify(files)),
      buildIdentity,
      components: Object.fromEntries(
        Object.entries(components).map(([role, file]) => [
          role,
          files.find((entry) => entry.path === file),
        ]),
      ),
      files,
      smoke: null,
    },
    root,
  );
}
export function validatePackageManifest(manifest, root, { requireSmoke = false } = {}) {
  assert(
    manifest?.schemaVersion === 1 &&
      manifest.kind === "desktop-package" &&
      manifest.evidence !== "local-frozen-package" &&
      manifest.source?.localPackageDigest === undefined,
    "Invalid package manifest",
  );
  const candidate = validateCandidate(manifest.candidate);
  assert(
    manifest.source?.sha === candidate.sha &&
      manifest.source.repository === candidate.repository &&
      manifest.source.candidateDigest === candidate.receiptSha256 &&
      manifest.version === candidate.version &&
      manifest.channel === candidate.channel,
    "Package source/channel identity differs",
  );
  assert(["windows-x64", "macos-arm64"].includes(manifest.platform), "Invalid platform");
  assert(
    Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 5000,
    "Invalid package file count",
  );
  const names = new Set();
  let total = 0;
  for (const file of manifest.files) {
    safeRelative(file.path);
    const folded = file.path.normalize("NFC").toLowerCase();
    assert(!names.has(folded), "Duplicate or case-colliding package files");
    names.add(folded);
    assert(
      sha256.test(file.sha256) &&
        Number.isSafeInteger(file.bytes) &&
        file.bytes > 0 &&
        file.bytes <= 512 * 1024 * 1024,
      "Invalid package file metadata",
    );
    total += file.bytes;
    if (root)
      assert.deepEqual(packageFile(root, file.path, file.role), file, "Package bytes changed");
    if (candidate.channel !== "stable")
      assert(
        file.role !== "updaterSignature" &&
          file.role !== "updaterArchive" &&
          !/^latest.*\.json$/i.test(path.basename(file.path)),
        "Nonstable candidates may not expose stable updater assets",
      );
  }
  assert(total <= 2 * 1024 * 1024 * 1024, "Package exceeds total bound");
  assert(
    manifest.artifactDigest === digest(JSON.stringify(manifest.files)),
    "Package artifact digest differs",
  );
  for (const role of [
    "launcher",
    "installer",
    "hostArchive",
    "hostNode",
    "hostEntry",
    "versionJson",
  ])
    assert(
      manifest.files.some(
        (file) => JSON.stringify(file) === JSON.stringify(manifest.components?.[role]),
      ),
      `Missing ${role} component`,
    );
  const stamp = parseBuildIdentity(manifest.buildIdentity);
  assert(
    stamp &&
      stamp.mode === "release-candidate" &&
      stamp.head === candidate.sha &&
      stamp.version === candidate.version &&
      stamp.channel === candidate.channel,
    "Invalid package build stamp",
  );
  if (manifest.platform === "windows-x64") {
    assert(
      manifest.windowsInstaller?.evidence === "nsis-extracted-native" &&
        manifest.windowsInstaller.installerSha256 === manifest.components.installer.sha256 &&
        manifest.windowsInstaller.hostArchiveSha256 === manifest.components.hostArchive.sha256 &&
        sha256.test(manifest.windowsInstaller.normalizedNativeSha256),
      "Windows smoke requires actual installer-native provenance",
    );
    assert(
      manifest.components.launcher.path === "build/package-payload/windows/native/bycoda.exe" &&
        manifest.files.some(
          (file) => JSON.stringify(file) === JSON.stringify(manifest.components.buildNative),
        ),
      "Missing installer-native/build-native relationship",
    );
    if (root) {
      for (const role of ["launcher", "buildNative"])
        assert.equal(
          normalizedWindowsBinaryHash(
            readFileSync(path.join(root, manifest.components[role].path)),
          ),
          manifest.windowsInstaller.normalizedNativeSha256,
          "Installer native bytes differ from compiled candidate",
        );
      const archive = `build/package-payload/windows/native/host/${path.basename(manifest.components.hostArchive.path)}`;
      assert(
        manifest.files.some((file) => file.path === archive) &&
          manifest.files.some((file) => file.path === `${archive}.sha256`),
        "Installer resources are missing from immutable package",
      );
      assert.equal(
        packageFile(root, archive).sha256,
        manifest.components.hostArchive.sha256,
        "Installer embeds a different Host archive",
      );
      assert.equal(
        parseSha256Sum(
          readFileSync(path.join(root, `${archive}.sha256`), "utf8"),
          path.basename(archive),
        ),
        manifest.components.hostArchive.sha256,
        "Installer embedded Host checksum differs",
      );
    }
  }
  if (candidate.channel === "stable") {
    assert(
      manifest.components.updaterArchive &&
        manifest.components.updaterSignature?.path ===
          `${manifest.components.updaterArchive.path}.sig`,
      "Missing paired updater signature",
    );
    for (const role of ["updaterArchive", "updaterSignature"])
      assert(
        manifest.files.some(
          (file) => JSON.stringify(file) === JSON.stringify(manifest.components[role]),
        ),
        "Updater component is not bound to verified files",
      );
  }
  if (requireSmoke || manifest.smoke) validateSmokeReceipt(manifest, manifest.smoke);
  return manifest;
}
export function validateSmokeReceipt(manifest, receipt) {
  assert(
    receipt?.schemaVersion === 1 &&
      receipt.evidence === "packaged-native-smoke" &&
      receipt.status === "passed",
    "Successful packaged native smoke is required",
  );
  assert(
    receipt.source?.sha === manifest.source.sha &&
      receipt.source.candidateDigest === manifest.source.candidateDigest &&
      receipt.version === manifest.version &&
      receipt.platform === manifest.platform &&
      receipt.artifactDigest === manifest.artifactDigest &&
      receipt.buildId === manifest.buildIdentity.buildId,
    "Smoke receipt belongs to other package bytes",
  );
  assert(
    smokeChecks.every((check) => receipt.checks?.[check] === true),
    "Package smoke checks are incomplete",
  );
  const start = Date.parse(receipt.startedAt),
    end = Date.parse(receipt.completedAt);
  assert(
    Number.isFinite(start) &&
      Number.isFinite(end) &&
      end >= start &&
      end <= Date.now() + 60000 &&
      end >= Date.now() - 24 * 60 * 60 * 1000,
    "Stale smoke receipt",
  );
  return receipt;
}
export function stagePackage(manifest, root, destination) {
  validatePackageManifest(manifest, root);
  assert(!existsSync(path.join(destination, "manifest.json")), "Package staging is immutable");
  for (const file of manifest.files) {
    const target = path.join(destination, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, file.path), target);
  }
  writeFileSync(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
}
function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(
      args[i]?.startsWith("--") && args[i + 1] && !args[i + 1].startsWith("--"),
      "Expected named option values",
    );
    result[args[i].slice(2)] = args[i + 1];
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2),
    input = options(args),
    root = path.resolve(input.root ?? ".");
  if (command === "create") {
    const candidate = JSON.parse(readFileSync(input.candidate, "utf8"));
    stagePackage(
      createPackageManifest({ candidate, platform: input.platform, root }),
      root,
      input.output,
    );
  } else if (command === "attach-smoke") {
    const file = path.join(root, "manifest.json"),
      manifest = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(manifest.smoke, null, "A package smoke receipt is immutable once attached");
    manifest.smoke = JSON.parse(readFileSync(input.receipt, "utf8"));
    validatePackageManifest(manifest, root, { requireSmoke: true });
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  } else if (command === "verify")
    validatePackageManifest(
      JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")),
      root,
      { requireSmoke: true },
    );
  else throw new Error("Expected create, attach-smoke or verify");
}
