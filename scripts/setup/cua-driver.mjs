import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";

// Embedded so a bundled Host never depends on a source-checkout JSON path.
// The adjacent vendor source.json is checked for exact equality in tests.
export const CUA_DRIVER_SOURCE = Object.freeze({
  repository: "https://github.com/trycua/cua",
  releaseTag: "cua-driver-rs-v0.49.11",
  version: "0.49.11",
  license: "MIT",
  licenseSha256: "d0a32419a44fa38d5023d1431dfcbedd1457eb5e7b2e6c7c87ca064facb41b41",
});
/** Upstream SHA256SUMS of the pinned release archives. */
const targets = {
  "win32-x64": {
    asset: "cua-driver-rs-0.49.11-windows-x86_64.zip",
    sha256: "6c477ec5acdb7feef42160dfe492d7c9a780cd0dc3e5446ab2b4251d8f448d40",
    folder: "cua-driver-rs-0.49.11-windows-x86_64",
  },
  "win32-arm64": {
    asset: "cua-driver-rs-0.49.11-windows-arm64.zip",
    sha256: "d4a43a9d1f682d9f2822b06bde1e883ca9626d9b8f6b523557f414832ebaee32",
    folder: "cua-driver-rs-0.49.11-windows-arm64",
  },
};
// shortcut: Windows only; macOS proxies through CuaDriver.app and Linux needs portal setup, add them when tested there.
const BINARY = "cua-driver.exe";
/** The CLI, its UIA worker and cursor helper; the embedding SDK files are not used. */
const FILES = [
  BINARY,
  "cua-driver-uia.exe",
  "cua-cursor-theme.exe",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
];
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const DOWNLOAD_DEADLINE_MS = 10 * 60_000;

async function hashFile(path) {
  const digest = createHash("sha256");
  await pipeline(createReadStream(path), digest);
  return digest.digest("hex");
}

function scope(options = {}) {
  const platform = options.platform ?? process.platform,
    arch = options.arch ?? process.arch;
  const target = targets[`${platform}-${arch}`];
  if (!target) throw new Error("cua-driver is available on Windows only in this release.");
  const cacheRoot = resolve(options.cacheRoot ?? join(homedir(), ".bycoda-build", "helpers"));
  return {
    platform,
    arch,
    ...target,
    target: `${platform}-${arch}`,
    cacheRoot,
    bundleDir: join(cacheRoot, "cua-driver", CUA_DRIVER_SOURCE.version, `${platform}-${arch}`),
  };
}

export function cuaDriverPlan(options = {}) {
  const plan = scope(options);
  return {
    ...plan,
    source: { ...CUA_DRIVER_SOURCE },
    url: `${CUA_DRIVER_SOURCE.repository}/releases/download/${CUA_DRIVER_SOURCE.releaseTag}/${plan.asset}`,
    files: [...FILES],
    configurationChanged: false,
  };
}

async function verifyBundle(bundleDir, plan) {
  const manifestPath = join(bundleDir, "manifest.json");
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.size > 32000) throw new Error("Invalid cua-driver manifest.");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest.schema !== 1 ||
    manifest.driver !== "cua-driver" ||
    manifest.version !== CUA_DRIVER_SOURCE.version ||
    manifest.releaseTag !== CUA_DRIVER_SOURCE.releaseTag ||
    manifest.target !== plan.target ||
    manifest.archiveSha256 !== plan.sha256 ||
    !Array.isArray(manifest.files) ||
    JSON.stringify(manifest.files.map((file) => file.name).sort()) !==
      JSON.stringify([...FILES].sort())
  )
    throw new Error("The cua-driver manifest does not match the pinned release.");
  for (const file of manifest.files) {
    const path = join(bundleDir, file.name);
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== file.size)
      throw new Error(`cua-driver file changed: ${file.name}`);
    if ((await hashFile(path)) !== file.sha256)
      throw new Error(`cua-driver file checksum changed: ${file.name}`);
  }
  const binary = manifest.files.find((file) => file.name === BINARY);
  return {
    manifestPath,
    binaryPath: join(bundleDir, BINARY),
    binarySha256: binary.sha256,
    sourceRef: CUA_DRIVER_SOURCE.releaseTag,
    protocol: "mcp",
    version: CUA_DRIVER_SOURCE.version,
    target: plan.target,
    files: manifest.files,
    manifest,
  };
}

async function optional(work) {
  try {
    return await work();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

/** Read-only: verifies the manifest and every file hash. Missing returns undefined. */
export async function readCuaDriver(options = {}) {
  const plan = scope(options);
  return optional(() => verifyBundle(plan.bundleDir, plan));
}

export async function readCuaDriverBundle(bundleDir, options = {}) {
  return optional(() => verifyBundle(bundleDir, scope(options)));
}

export async function copyCuaDriverBundle(bundleDir, destination, options = {}) {
  const plan = scope(options);
  const source = await verifyBundle(bundleDir, plan);
  await mkdir(destination, { recursive: true });
  for (const file of source.files)
    await copyFile(
      join(bundleDir, file.name),
      join(destination, file.name),
      constants.COPYFILE_EXCL,
    );
  await copyFile(source.manifestPath, join(destination, "manifest.json"), constants.COPYFILE_EXCL);
  return verifyBundle(destination, plan);
}

async function download(url, path, expectedSha256, signal) {
  const response = await fetch(url, { redirect: "follow", signal });
  if (!response.ok || !response.body)
    throw new Error(`cua-driver download failed (HTTP ${response.status}).`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_ARCHIVE_BYTES) throw new Error("cua-driver archive is unexpectedly large.");
  const digest = createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk, _encoding, done) {
      size += chunk.length;
      if (size > MAX_ARCHIVE_BYTES)
        return done(new Error("cua-driver archive is unexpectedly large."));
      digest.update(chunk);
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(path, { flags: "wx" }), {
    signal,
  });
  if (digest.digest("hex") !== expectedSha256)
    throw new Error("cua-driver archive checksum does not match the pinned release.");
}

/** Windows' bundled bsdtar extracts zip archives without a shell. */
function extract(archive, directory, signal) {
  const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  return new Promise((done, fail) => {
    const child = spawn(tar, ["-xf", archive, "-C", directory], {
      windowsHide: true,
      shell: false,
      stdio: "ignore",
      signal,
      timeout: 120_000,
    });
    child.once("error", fail);
    child.once("close", (code) =>
      code === 0 ? done() : fail(new Error(`cua-driver archive extraction failed (${code}).`)),
    );
  });
}

/**
 * Downloads the pinned release archive, checks the upstream SHA-256, extracts only the CLI
 * files and writes a manifest of their hashes. Never enables control or changes settings.
 */
export async function prepareCuaDriver(options = {}, deps = {}) {
  const plan = cuaDriverPlan(options);
  const existing = await readCuaDriver(options).catch(() => undefined);
  if (existing) return existing;
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(DOWNLOAD_DEADLINE_MS),
  ]);
  const work = join(plan.cacheRoot, "cua-driver", ".work", randomUUID());
  await mkdir(work, { recursive: true });
  try {
    const progress = (stage) =>
      options.onProgress?.({ stage, workspace: work, target: plan.target });
    progress("acquiring");
    const archive = join(work, plan.asset);
    await (deps.download ?? download)(plan.url, archive, plan.sha256, signal);
    progress("verifying");
    const unpacked = join(work, "unpacked");
    await mkdir(unpacked);
    await (deps.extract ?? extract)(archive, unpacked, signal);
    const staged = join(work, "bundle");
    await mkdir(staged);
    const root = join(unpacked, plan.folder);
    const present = new Set(await readdir(root));
    const files = [];
    for (const name of FILES) {
      if (!present.has(name)) throw new Error(`cua-driver archive is missing ${name}.`);
      const entry = await lstat(join(root, name));
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new Error(`cua-driver archive entry is not a file: ${name}.`);
      await copyFile(join(root, name), join(staged, name), constants.COPYFILE_EXCL);
      files.push({ name, size: entry.size, sha256: await hashFile(join(staged, name)) });
    }
    const license = files.find((file) => file.name === "LICENSE");
    if (license.sha256 !== CUA_DRIVER_SOURCE.licenseSha256)
      throw new Error("cua-driver license changed from the pinned MIT license.");
    await writeFile(
      join(staged, "manifest.json"),
      `${JSON.stringify(
        {
          schema: 1,
          driver: "cua-driver",
          version: CUA_DRIVER_SOURCE.version,
          releaseTag: CUA_DRIVER_SOURCE.releaseTag,
          target: plan.target,
          archive: plan.asset,
          archiveSha256: plan.sha256,
          installedAt: new Date().toISOString(),
          files,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
    signal.throwIfAborted();
    await mkdir(dirname(plan.bundleDir), { recursive: true });
    await rename(staged, plan.bundleDir);
    progress("ready");
    return verifyBundle(plan.bundleDir, plan);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

export const CUA_DRIVER_FILES = FILES;
