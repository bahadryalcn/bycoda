/** Explicit standalone guardian build. Ordinary host:build never invokes Cargo. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseBuildIdentity } from "./build-info.mjs";

export const guardianTargets = Object.freeze({
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
});
export const guardianManifestName = "provider-guardian.json";
export const guardianMaxBytes = 64 * 1024 * 1024;
const manifestMaxBytes = 64 * 1024;
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex = /^[a-f0-9]{64}$/;
const manifestKeys = [
  "protocolVersion",
  "target",
  "rustTarget",
  "artifact",
  "size",
  "rawSha256",
  "sourceFingerprint",
  "buildIdentity",
];

function targetInfo(target) {
  if (!Object.hasOwn(guardianTargets, target))
    throw new Error(`Unsupported guardian target: ${target}`);
  return guardianTargets[target];
}
export function guardianFilename(target) {
  targetInfo(target);
  return `bycoda-provider-guardian${target.startsWith("win32-") ? ".exe" : ""}`;
}
function closed(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function inside(root, path) {
  const suffix = relative(root, path);
  return suffix !== "" && !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`);
}
function validBuildIdentity(value) {
  if (value === null) return true;
  const parsed = parseBuildIdentity(value);
  if (
    !parsed ||
    !closed(value, Object.keys(parsed)) ||
    !closed(value.components, ["web", "native", "host"])
  )
    return false;
  return (
    value.dirtyPaths.every((row) => closed(row, ["path", "status"])) &&
    value.includedSources.every((row) =>
      closed(
        row,
        row.deliveryCommit
          ? ["repositoryId", "sourceHead", "deliveryCommit"]
          : ["repositoryId", "sourceHead"],
      ),
    )
  );
}
export function validateGuardianManifest(value, target) {
  const rustTarget = targetInfo(target);
  if (
    !closed(value, manifestKeys) ||
    value.protocolVersion !== 1 ||
    value.target !== target ||
    value.rustTarget !== rustTarget ||
    value.artifact !== guardianFilename(target) ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > guardianMaxBytes ||
    typeof value.rawSha256 !== "string" ||
    !hex.test(value.rawSha256) ||
    typeof value.sourceFingerprint !== "string" ||
    !hex.test(value.sourceFingerprint) ||
    !validBuildIdentity(value.buildIdentity)
  )
    throw new Error("Invalid guardian manifest or target");
  return value;
}

/** Header/architecture validation only; this does not prove executable behavior. */
export function validateGuardianBinary(bytes, target) {
  targetInfo(target);
  let valid = Buffer.isBuffer(bytes) && bytes.length >= 128 && bytes.length <= guardianMaxBytes;
  if (valid && target.startsWith("win32-")) {
    const offset = bytes.readUInt32LE(60);
    valid = bytes.toString("ascii", 0, 2) === "MZ" && offset <= bytes.length - 26;
    if (valid)
      valid =
        bytes.toString("ascii", offset, offset + 4) === "PE\0\0" &&
        bytes.readUInt16LE(offset + 4) === (target.endsWith("x64") ? 0x8664 : 0xaa64) &&
        (bytes.readUInt16LE(offset + 22) & 2) !== 0 &&
        (bytes.readUInt16LE(offset + 22) & 0x2000) === 0 &&
        bytes.readUInt16LE(offset + 24) === 0x20b;
  } else if (valid && target.startsWith("linux-")) {
    valid =
      bytes.subarray(0, 7).equals(Buffer.from([0x7f, 69, 76, 70, 2, 1, 1])) &&
      [2, 3].includes(bytes.readUInt16LE(16)) &&
      bytes.readUInt16LE(18) === (target.endsWith("x64") ? 62 : 183);
  } else if (valid) {
    valid =
      bytes.readUInt32LE(0) === 0xfeedfacf &&
      bytes.readUInt32LE(4) === (target.endsWith("x64") ? 0x01000007 : 0x0100000c) &&
      bytes.readUInt32LE(12) === 2;
  }
  if (!valid) throw new Error(`Guardian executable does not match ${target}`);
}

async function boundedFile(path, limit, allowEmpty = false) {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink())
    throw new Error("Guardian input must be a regular file without symbolic links");
  const file = await open(path, "r");
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > limit || (!allowEmpty && before.size === 0))
      throw new Error("Guardian input exceeds bounded regular file limit");
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await file.stat();
    if (
      length !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino ||
      before.dev !== after.dev
    )
      throw new Error("Guardian input changed while reading");
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}

export async function readGuardianBundle(directory, target) {
  targetInfo(target);
  const root = await realpath(directory);
  const manifestBytes = await boundedFile(join(root, guardianManifestName), manifestMaxBytes);
  const manifest = validateGuardianManifest(JSON.parse(manifestBytes.toString("utf8")), target);
  const artifact = join(root, manifest.artifact);
  if ((await realpath(artifact)) !== artifact)
    throw new Error("Guardian artifact path was redirected");
  const bytes = await boundedFile(artifact, guardianMaxBytes);
  if (bytes.length !== manifest.size || digest(bytes) !== manifest.rawSha256)
    throw new Error("Guardian executable size/checksum mismatch");
  validateGuardianBinary(bytes, target);
  return { manifest, artifact, bytes };
}

/** Exclusive publication never replaces a prior executable or manifest. */
async function publish(path, bytes, executable = false) {
  const temporary = join(dirname(path), `.guardian-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: executable ? 0o755 : 0o644 });
    if (executable) await chmod(temporary, 0o755);
    try {
      await link(temporary, path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function stageGuardianBundle(
  directory,
  target,
  bytes,
  sourceFingerprint,
  buildIdentity = null,
  beforePublish = async () => {},
) {
  validateGuardianBinary(bytes, target);
  const manifest = validateGuardianManifest(
    {
      protocolVersion: 1,
      target,
      rustTarget: targetInfo(target),
      artifact: guardianFilename(target),
      size: bytes.length,
      rawSha256: digest(bytes),
      sourceFingerprint,
      buildIdentity,
    },
    target,
  );
  const encoded = Buffer.from(`${JSON.stringify(manifest)}\n`);
  if (encoded.length > manifestMaxBytes) throw new Error("Guardian manifest exceeds bounded size");
  await mkdir(directory, { recursive: true });
  const root = await realpath(directory);
  const artifact = join(root, manifest.artifact);
  await publish(artifact, bytes, true);
  const actual = await boundedFile(artifact, guardianMaxBytes);
  if (actual.length !== bytes.length || digest(actual) !== manifest.rawSha256)
    throw new Error(
      "Existing immutable guardian executable differs; choose a fresh output directory",
    );
  await beforePublish();
  await publish(join(root, guardianManifestName), encoded);
  const staged = await readGuardianBundle(root, target);
  if (JSON.stringify(staged.manifest) !== JSON.stringify(manifest))
    throw new Error(
      "Existing immutable guardian manifest differs; choose a fresh output directory",
    );
  return staged.manifest;
}

export async function copyGuardianBundle(source, destination, target, expectedFingerprint) {
  const bundle = await readGuardianBundle(source, target);
  if (
    expectedFingerprint !== undefined &&
    bundle.manifest.sourceFingerprint !== expectedFingerprint
  )
    throw new Error("Guardian artifact does not match current source inputs");
  return stageGuardianBundle(
    destination,
    target,
    bundle.bytes,
    bundle.manifest.sourceFingerprint,
    bundle.manifest.buildIdentity,
  );
}

/** Check every source against every selected destination before any package rm. */
export async function assertGuardianPackagingSeparation(
  sourceDirectories,
  outputDirectory,
  targets,
) {
  const output = await realpath(outputDirectory);
  const sources = await Promise.all(sourceDirectories.map((path) => realpath(path)));
  for (const target of targets) {
    targetInfo(target);
    let destination = join(output, target);
    try {
      destination = await realpath(destination);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!inside(output, destination))
      throw new Error("Guardian package output escaped its directory");
    for (const source of sources)
      if (source === destination || inside(source, destination) || inside(destination, source))
        throw new Error("Guardian source and package output overlap");
  }
}

async function sourcePaths(root) {
  const names = [
    "Cargo.toml",
    "Cargo.lock",
    "package.json",
    "packages/provider-process-guardian/Cargo.toml",
    "packages/provider-process-guardian/package.json",
    "scripts/build/provider-guardian.mjs",
    "scripts/build/build-info.mjs",
  ];
  async function walk(path) {
    const entries = await readdir(join(root, path), { withFileTypes: true });
    for (const entry of entries) {
      const child = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("Linked guardian source is unsupported");
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) names.push(child);
      else throw new Error("Guardian source must be regular files");
    }
  }
  await walk("packages/provider-process-guardian/src");
  for (const path of [
    "packages/provider-process-guardian/build.rs",
    ".cargo/config.toml",
    ".cargo/config",
    "rust-toolchain.toml",
    "rust-toolchain",
  ]) {
    try {
      await lstat(join(root, path));
      names.push(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (names.length > 4096) throw new Error("Guardian source inventory exceeds bound");
  return names.sort();
}
export async function guardianSourceFingerprint(root = repository) {
  root = await realpath(root);
  const hash = createHash("sha256").update("bycoda-provider-guardian-source-v1\0");
  for (const path of await sourcePaths(root)) {
    const bytes = await boundedFile(join(root, path), 16 * 1024 * 1024, true);
    hash.update(path).update("\0").update(digest(bytes)).update("\n");
  }
  return hash.digest("hex");
}

export async function buildGuardianBundle({
  root = repository,
  target,
  output = join(root, "build/host-guardian"),
  targetDir = join(root, "build/provider-guardian-cargo"),
  profile = "release",
  buildIdentity = null,
}) {
  root = resolve(root);
  const rustTarget = targetInfo(target);
  if (!["release", "debug"].includes(profile))
    throw new Error("Guardian profile must be release or debug");
  const before = await guardianSourceFingerprint(root);
  const args = [
    "build",
    "--locked",
    "-p",
    "bycoda-provider-process-guardian",
    "--bin",
    "bycoda-provider-guardian",
    "--target",
    rustTarget,
    "--target-dir",
    resolve(targetDir),
  ];
  if (profile === "release") args.push("--release");
  const environment = { ...process.env };
  if (target.startsWith("win32-")) {
    if (Object.hasOwn(environment, "CARGO_ENCODED_RUSTFLAGS"))
      environment.CARGO_ENCODED_RUSTFLAGS = [
        ...(environment.CARGO_ENCODED_RUSTFLAGS ? [environment.CARGO_ENCODED_RUSTFLAGS] : []),
        "-C",
        "target-feature=+crt-static",
      ].join("\u001f");
    else environment.RUSTFLAGS = `${environment.RUSTFLAGS ?? ""} -C target-feature=+crt-static`;
  }
  execFileSync("cargo", args, { cwd: root, stdio: "inherit", windowsHide: true, env: environment });
  const binary = join(resolve(targetDir), rustTarget, profile, guardianFilename(target));
  const bytes = await boundedFile(binary, guardianMaxBytes);
  if (before !== (await guardianSourceFingerprint(root)))
    throw new Error("Guardian source inputs changed during build");
  return stageGuardianBundle(
    join(resolve(output), target),
    target,
    bytes,
    before,
    buildIdentity,
    async () => {
      if (before !== (await guardianSourceFingerprint(root)))
        throw new Error("Guardian source inputs changed before publication");
    },
  );
}

export function parseGuardianBuildArgs(args) {
  const options = { target: `${process.platform}-${process.arch}` };
  const fields = {
    "--target": "target",
    "--output": "output",
    "--target-dir": "targetDir",
    "--profile": "profile",
    "--build-manifest": "buildManifest",
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--" && index === 0) continue;
    if (
      !Object.hasOwn(fields, flag) ||
      seen.has(flag) ||
      !args[index + 1] ||
      args[index + 1].startsWith("--")
    )
      throw new Error(`Invalid guardian build option: ${flag}`);
    seen.add(flag);
    options[fields[flag]] = args[++index];
  }
  targetInfo(options.target);
  return options;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = parseGuardianBuildArgs(process.argv.slice(2));
  const identityPath = options.buildManifest ?? process.env.BYCODA_BUILD_MANIFEST;
  if (identityPath) {
    options.buildIdentity = parseBuildIdentity(
      JSON.parse((await boundedFile(identityPath, manifestMaxBytes)).toString("utf8")),
    );
    if (!options.buildIdentity) throw new Error("Guardian build identity is invalid");
  }
  console.log(JSON.stringify(await buildGuardianBundle(options)));
}
