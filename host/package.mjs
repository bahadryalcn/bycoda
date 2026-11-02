import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  chmod,
  copyFile,
  readdir,
  rm,
  utimes,
  lstat,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { createTarArchive, extractTarMembers } from "./package-archive.mjs";
import { readBuildIdentity } from "../scripts/build/build-info.mjs";
import { readDesktopHelper, copyDesktopHelperBundle } from "../scripts/setup/agent-desktop.mjs";
import { signDesktopHelperBundle } from "../scripts/release/sign-desktop-helper.mjs";
import {
  admissionSourceFingerprint,
  assertAdmissionPackagingSeparation,
  copyAdmissionBundle,
  readAdmissionBundle,
  smokeAdmissionBundle,
  validateAdmissionPackageDestination,
} from "../scripts/build/physical-store-admission.mjs";
import {
  assertGuardianPackagingSeparation,
  copyGuardianBundle,
  guardianManifestName,
  guardianSourceFingerprint,
  readGuardianBundle,
} from "../scripts/build/provider-guardian.mjs";

// Official Node release checksums, pinned so release builds are reproducible.
// https://nodejs.org/dist/v24.21.0/SHASUMS256.txt
const nodeVersion = "24.21.0";
const runtimes = {
  "darwin-arm64": "bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057",
  "darwin-x64": "1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097",
  "linux-arm64": "724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5",
  "linux-x64": "6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff",
  "win32-x64": "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541",
  "win32-arm64": "8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921",
};
const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;
const ps = (script) =>
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        `$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; ${script}`,
        "utf16le",
      ).toString("base64"),
    ],
    {
      windowsHide: true,
      // Avoid loading inherited PowerShell 7 modules in Windows PowerShell 5.1.
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PSMODULEPATH"),
      ),
    },
  );
const args = process.argv.slice(2);
const target = args.includes("--target")
  ? args[args.indexOf("--target") + 1]
  : `${process.platform}-${process.arch}`;
const targets = args.includes("--all") ? Object.keys(runtimes) : [target];
const signDesktopHelper = args.includes("--sign-desktop-helper");
if(signDesktopHelper && (process.platform!=="win32" || targets.length!==1 || target!==`win32-${process.arch}` || !args.includes("--desktop-helper")))
  throw new Error("--sign-desktop-helper requires one local Windows target and --desktop-helper.");
const desktopHelperCacheIndex = args.indexOf("--desktop-helper-cache");
if (
  desktopHelperCacheIndex >= 0 &&
  (!args[desktopHelperCacheIndex + 1] || args[desktopHelperCacheIndex + 1].startsWith("--"))
)
  throw new Error("--desktop-helper-cache requires a directory");
const desktopHelperCache =
  desktopHelperCacheIndex >= 0 ? resolve(args[desktopHelperCacheIndex + 1]) : undefined;
const desktopHelpers = new Map();
for (const target of targets) {
  if (!(target in runtimes)) throw new Error(`Unsupported host target: ${target}`);
  const [platform, arch] = target.split("-");
  const helper = await readDesktopHelper({ cacheRoot: desktopHelperCache, platform, arch });
  if (!helper && (args.includes("--desktop-helper") || desktopHelperCacheIndex >= 0))
    throw new Error(`Prepare the pinned desktop helper before packaging ${target}`);
  if (helper) desktopHelpers.set(target, helper);
}
const nativeAdmission = args.includes("--native-admission");
const admissionDirectoryIndex = args.indexOf("--native-admission-dir");
if (
  admissionDirectoryIndex >= 0 &&
  (!nativeAdmission ||
    !args[admissionDirectoryIndex + 1] ||
    args[admissionDirectoryIndex + 1].startsWith("--"))
)
  throw new Error("--native-admission-dir requires --native-admission and a directory");
const admissionDirectory = resolve(
  admissionDirectoryIndex >= 0 ? args[admissionDirectoryIndex + 1] : "build/host-native",
);
const providerGuardian = args.includes("--provider-guardian");
const guardianDirectoryIndex = args.indexOf("--provider-guardian-dir");
if (
  guardianDirectoryIndex >= 0 &&
  (!providerGuardian ||
    !args[guardianDirectoryIndex + 1] ||
    args[guardianDirectoryIndex + 1].startsWith("--"))
)
  throw new Error("--provider-guardian-dir requires --provider-guardian and a directory");
const guardianDirectory = resolve(
  guardianDirectoryIndex >= 0 ? args[guardianDirectoryIndex + 1] : "build/host-guardian",
);
const output = resolve("build/host-packages");
const cache = resolve(process.env.BYCODA_HOST_RUNTIME_CACHE ?? "build/host-runtime-cache");
await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const manifestPath = process.env.BYCODA_BUILD_MANIFEST ?? resolve("build/build-info.json");
const buildIdentity = await readBuildIdentity(manifestPath);
if (process.env.BYCODA_BUILD_MANIFEST && !buildIdentity)
  throw new Error("Build identity manifest is missing or invalid");
if (buildIdentity && buildIdentity.version !== version)
  throw new Error("Build identity version does not match the host package");
// A present default bundle is included; an explicitly requested missing one is fatal.
// lstat observes dangling links too, so invalid declared metadata cannot disappear.
const guardianBundles = new Map();
for (const target of targets) {
  const directory = join(guardianDirectory, target);
  let present = false;
  try {
    await lstat(join(directory, guardianManifestName));
    present = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (providerGuardian || present) {
    const bundle = await readGuardianBundle(directory, target);
    guardianBundles.set(target, { directory, manifest: bundle.manifest });
  }
}
const guardianFingerprint = guardianBundles.size
  ? await guardianSourceFingerprint(resolve("."))
  : null;
async function validateGuardianInputs() {
  if (!guardianBundles.size) return;
  await assertGuardianPackagingSeparation(
    [...guardianBundles.values()].map((bundle) => bundle.directory),
    output,
    targets,
  );
  if ((await guardianSourceFingerprint(resolve("."))) !== guardianFingerprint)
    throw new Error("Guardian source inputs changed before packaging");
  for (const [target, expected] of guardianBundles) {
    const actual = await readGuardianBundle(expected.directory, target);
    if (
      actual.manifest.sourceFingerprint !== guardianFingerprint ||
      JSON.stringify(actual.manifest) !== JSON.stringify(expected.manifest)
    )
      throw new Error(`Guardian source/artifact mismatch for ${target}`);
  }
}
await validateGuardianInputs();
// Validate every requested native input before downloading or replacing a package.
const admissionFingerprint = nativeAdmission
  ? await admissionSourceFingerprint(resolve("."))
  : null;
if (nativeAdmission) await assertAdmissionPackagingSeparation(admissionDirectory, output, targets);
if (nativeAdmission)
  for (const target of targets) {
    const bundle = await readAdmissionBundle(join(admissionDirectory, target), target);
    if (bundle.manifest.sourceFingerprint !== admissionFingerprint)
      throw new Error(`Native admission source mismatch for ${target}`);
    if (target === `${process.platform}-${process.arch}`)
      await validateAdmissionPackageDestination(output, target, bundle.manifest.artifact);
  }
for (const target of targets) {
  if (!(target in runtimes)) throw new Error(`Unsupported host target: ${target}`);
  const windows = target.startsWith("win32-");
  const extension = windows ? "zip" : "tar.gz";
  const stem = `node-v${nodeVersion}-${target.replace("win32-", "win-")}`;
  const archive = join(cache, `${stem}.${extension}`);
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch {
    /* first download */
  }
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== runtimes[target]) {
    const response = await fetch(`https://nodejs.org/dist/v${nodeVersion}/${stem}.${extension}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Runtime download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== runtimes[target])
      throw new Error("Node runtime checksum mismatch");
    await writeFile(archive, bytes);
  }
  const folder = join(output, target);
  await validateGuardianInputs();
  if (nativeAdmission) {
    await assertAdmissionPackagingSeparation(admissionDirectory, output, targets);
    const bundle = await readAdmissionBundle(join(admissionDirectory, target), target);
    if (bundle.manifest.sourceFingerprint !== admissionFingerprint)
      throw new Error(`Native admission source mismatch for ${target}`);
    if (target === `${process.platform}-${process.arch}`)
      await validateAdmissionPackageDestination(output, target, bundle.manifest.artifact);
  }
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  if (windows) {
    if (process.platform === "win32") {
      const unpacked = join(folder, "runtime");
      ps(`Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(unpacked)}`);
      await copyFile(join(unpacked, stem, "node.exe"), join(folder, "node.exe"));
      await copyFile(join(unpacked, stem, "LICENSE"), join(folder, "LICENSE"));
      await rm(unpacked, { recursive: true, force: true });
    } else {
      execFileSync("unzip", [
        "-q",
        "-j",
        archive,
        `${stem}/node.exe`,
        `${stem}/LICENSE`,
        "-d",
        folder,
      ]);
    }
  } else extractTarMembers(archive, folder, [`${stem}/bin/node`, `${stem}/LICENSE`]);
  await copyFile("build/host/host.mjs", join(folder, "host.mjs"));
  await copyFile("build/host/bycoda-host.mjs", join(folder, "bycoda-host.mjs"));
  await copyFile("build/host/host-notes-worker.mjs", join(folder, "host-notes-worker.mjs"));
  await copyFile("build/host/store-worker.mjs", join(folder, "store-worker.mjs"));
  await copyFile("build/host/snapshot-worker.mjs", join(folder, "snapshot-worker.mjs"));
  await copyFile("host/provider-guard.mjs", join(folder, "provider-guard.mjs"));
  if (desktopHelpers.has(target)) {
    const expected = desktopHelpers.get(target),
      [platform, arch] = target.split("-");
    const copied = await copyDesktopHelperBundle(
      dirname(expected.manifestPath),
      join(folder, "agent-desktop"),
      { platform, arch },
    );
    if (JSON.stringify(copied.manifest) !== JSON.stringify(expected.manifest))
      throw new Error(`Desktop helper changed before packaging ${target}`);
    if(signDesktopHelper)await signDesktopHelperBundle(join(folder,"agent-desktop"),{
      certificateThumbprint:process.env.BYCODA_WINDOWS_SIGNING_CERT_SHA1,
      storeLocation:process.env.BYCODA_WINDOWS_SIGNING_STORE || "CurrentUser",
      arch,
    });
  }
  if (nativeAdmission)
    await copyAdmissionBundle(
      join(admissionDirectory, target),
      folder,
      target,
      admissionFingerprint,
    );
  if (guardianBundles.has(target)) {
    const expected = guardianBundles.get(target);
    const copied = await copyGuardianBundle(
      expected.directory,
      folder,
      target,
      guardianFingerprint,
    );
    if (JSON.stringify(copied) !== JSON.stringify(expected.manifest))
      throw new Error(`Guardian artifact changed while packaging ${target}`);
  }
  await copyFile("LICENSE", join(folder, "BYCODA-LICENSE"));
  await writeFile(
    join(folder, "version.json"),
    JSON.stringify({ version, nodeVersion, target, ...(buildIdentity ? { buildIdentity } : {}) }),
  );
  if (buildIdentity)
    await writeFile(join(folder, "build-info.json"), JSON.stringify(buildIdentity));
  if (windows) {
    await writeFile(
      join(folder, "bycoda-host.cmd"),
      '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"%~dp0node.exe" "%~dp0host.mjs" %*\r\nexit /b %errorlevel%\r\n',
    );
  } else {
    await writeFile(
      join(folder, "bycoda-host"),
      '#!/bin/sh\nset -eu\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$DIR/bin/node" "$DIR/host.mjs" "$@"\n',
    );
    await chmod(join(folder, "bycoda-host"), 0o755);
  }
  if (target === `${process.platform}-${process.arch}`) {
    const executable = windows ? join(folder, "node.exe") : join(folder, "bin/node");
    const actual = execFileSync(executable, [join(folder, "host.mjs"), "--version"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    if (actual !== version) throw new Error("Packaged host failed its executable smoke test");
    if (nativeAdmission) await smokeAdmissionBundle(executable, folder, target);
  }
  // Local installation consumes this directory directly: no ZIP/tar round trip.
  if (args.includes("--directory-only")) {
    console.log(`${folder} (${version}, Node ${nodeVersion})`);
    continue;
  }
  // ZIP cannot store times before 1980; a frozen checkout may carry epoch times.
  const now = new Date();
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true }))
    await utimes(join(entry.parentPath, entry.name), now, now);
  await utimes(folder, now, now);
  const filename = `bycoda-host-${target}.${extension}`;
  await rm(join(output, filename), { force: true });
  if (windows) {
    if (process.platform === "win32")
      ps(
        `Compress-Archive -Path ${psQuote(join(folder, "*"))} -DestinationPath ${psQuote(join(output, filename))}`,
      );
    else
      execFileSync("zip", ["-q", "-r", join(output, filename), "."], {
        cwd: folder,
      });
  } else createTarArchive(join(output, filename), folder);
  const hash = createHash("sha256")
    .update(await readFile(join(output, filename)))
    .digest("hex");
  await writeFile(join(output, `${filename}.sha256`), `${hash}  ${filename}\n`);
  console.log(`${filename} (${version}, Node ${nodeVersion})`);
}
