import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const binaryName = "bycoda-host-launcher.exe";
const manifestName = "host-service-launcher.json";
const targets = {
  "win32-x64": { triple: "x86_64-pc-windows-msvc", machine: 0x8664 },
  "win32-arm64": { triple: "aarch64-pc-windows-msvc", machine: 0xaa64 },
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const samePath = (left, right) =>
  process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
async function assertPlainPath(path) {
  let current = resolve(path);
  for (;;) {
    try {
      const actual = await realpath(current);
      if (!samePath(actual, current) || (await lstat(current)).isSymbolicLink())
        throw new Error("Host launcher paths must not be redirected.");
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}
function targetInfo(target) {
  if (!Object.hasOwn(targets, target))
    throw new Error(`Unsupported Host launcher target: ${target}`);
  return targets[target];
}
async function regularFile(path, maximum = 16 * 1024 * 1024) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > maximum) throw new Error(`Invalid Host launcher file: ${path}`);
  return readFile(path);
}
export async function hostServiceLauncherSourceFingerprint() {
  const hash = createHash("sha256").update("bycoda-host-service-launcher-v1\0");
  for (const path of [
    "Cargo.toml",
    "Cargo.lock",
    "packages/host-service-launcher/Cargo.toml",
    "packages/host-service-launcher/src/lib.rs",
    "packages/host-service-launcher/src/main.rs",
    "scripts/build/host-service-launcher.mjs",
  ]) {
    hash
      .update(path)
      .update("\0")
      .update(digest(await regularFile(join(root, path))))
      .update("\n");
  }
  return hash.digest("hex");
}
export function validateHostServiceLauncherImage(bytes, target) {
  const { machine } = targetInfo(target);
  if (bytes.length < 64 || bytes.toString("ascii", 0, 2) !== "MZ")
    throw new Error("Invalid Host launcher PE image.");
  const offset = bytes.readUInt32LE(0x3c);
  if (
    offset > bytes.length - 94 ||
    bytes.readUInt32LE(offset) !== 0x4550 ||
    bytes.readUInt16LE(offset + 4) !== machine ||
    bytes.readUInt16LE(offset + 24) !== 0x20b ||
    bytes.readUInt16LE(offset + 92) !== 2
  ) {
    throw new Error("Host launcher must be a matching Windows GUI executable.");
  }
}
export async function readHostServiceLauncher({ target, directory }) {
  targetInfo(target);
  await assertPlainPath(directory);
  if (!(await lstat(directory)).isDirectory())
    throw new Error("Host launcher bundle must be a regular directory.");
  const manifest = JSON.parse(await regularFile(join(directory, manifestName), 8192));
  const binaryPath = join(resolve(directory), binaryName);
  const bytes = await regularFile(binaryPath);
  validateHostServiceLauncherImage(bytes, target);
  if (
    manifest.version !== 1 ||
    manifest.target !== target ||
    manifest.sha256 !== digest(bytes) ||
    manifest.sourceFingerprint !== (await hostServiceLauncherSourceFingerprint())
  ) {
    throw new Error("Host launcher source, target or checksum mismatch.");
  }
  return { binaryPath, manifest };
}
export async function copyHostServiceLauncher({ target, directory, outputDirectory }) {
  const { binaryPath, manifest } = await readHostServiceLauncher({ target, directory });
  await assertPlainPath(outputDirectory);
  await assertPlainPath(join(outputDirectory, binaryName));
  await assertPlainPath(join(outputDirectory, manifestName));
  await mkdir(outputDirectory, { recursive: true });
  const destination = join(resolve(outputDirectory), binaryName);
  if (resolve(binaryPath) !== destination) await copyFile(binaryPath, destination);
  if (digest(await regularFile(destination)) !== manifest.sha256)
    throw new Error("Host launcher changed while copying.");
  await writeFile(join(outputDirectory, manifestName), JSON.stringify(manifest, null, 2) + "\n");
  return destination;
}
export async function buildHostServiceLauncher({
  target,
  outputDirectory = join(root, "build/host-launcher", target),
}) {
  const { triple } = targetInfo(target);
  await assertPlainPath(outputDirectory);
  await assertPlainPath(join(outputDirectory, binaryName));
  await assertPlainPath(join(outputDirectory, manifestName));
  const fingerprint = await hostServiceLauncherSourceFingerprint();
  const targetDirectory = join(root, "build/host-launcher-cargo");
  const environment = { ...process.env };
  if (Object.hasOwn(environment, "CARGO_ENCODED_RUSTFLAGS")) {
    environment.CARGO_ENCODED_RUSTFLAGS = [
      environment.CARGO_ENCODED_RUSTFLAGS,
      "-C",
      "target-feature=+crt-static",
    ]
      .filter(Boolean)
      .join("\u001f");
  } else environment.RUSTFLAGS = `${environment.RUSTFLAGS ?? ""} -C target-feature=+crt-static`;
  execFileSync(
    "cargo",
    [
      "build",
      "--locked",
      "--release",
      "-p",
      "bycoda-host-service-launcher",
      "--bin",
      "bycoda-host-launcher",
      "--target",
      triple,
      "--target-dir",
      targetDirectory,
    ],
    {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      timeout: 600000,
      env: environment,
    },
  );
  const source = join(targetDirectory, triple, "release", binaryName);
  validateHostServiceLauncherImage(await regularFile(source), target);
  await mkdir(outputDirectory, { recursive: true });
  const binaryPath = join(resolve(outputDirectory), binaryName);
  await copyFile(source, binaryPath);
  const certificate = process.env.BYCODA_WINDOWS_SIGNING_CERT_SHA1?.trim();
  if (certificate) {
    if (process.platform !== "win32" || !/^[a-fA-F0-9]{40}$/.test(certificate))
      throw new Error(
        "Host launcher signing requires Windows and an exact certificate thumbprint.",
      );
    const receipt = JSON.parse(
      execFileSync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-File",
          join(root, "scripts/release/sign-desktop-helper.ps1"),
          "-BinaryPath",
          binaryPath,
          "-ExpectedSha256",
          digest(await regularFile(binaryPath)),
          "-CertificateThumbprint",
          certificate,
          "-StoreLocation",
          process.env.BYCODA_WINDOWS_SIGNING_STORE || "CurrentUser",
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 120000,
          env: Object.fromEntries(
            Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PSMODULEPATH"),
          ),
        },
      ).trim(),
    );
    if (
      receipt.status !== "Valid" ||
      !receipt.timestamped ||
      receipt.signerThumbprint?.toUpperCase() !== certificate.toUpperCase() ||
      receipt.sha256 !== digest(await regularFile(binaryPath))
    )
      throw new Error("Host launcher signature did not verify.");
  } else
    console.log("Host launcher is unsigned: BYCODA_WINDOWS_SIGNING_CERT_SHA1 is not configured.");
  if (fingerprint !== (await hostServiceLauncherSourceFingerprint()))
    throw new Error("Host launcher source changed during build.");
  await writeFile(
    join(outputDirectory, manifestName),
    JSON.stringify(
      {
        version: 1,
        target,
        sourceFingerprint: fingerprint,
        sha256: digest(await regularFile(binaryPath)),
      },
      null,
      2,
    ) + "\n",
  );
  await readHostServiceLauncher({ target, directory: outputDirectory });
  return binaryPath;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = { target: `${process.platform}-${process.arch}` };
  for (let index = 0; index < args.length; index += 2) {
    const field = { "--target": "target", "--output": "outputDirectory" }[args[index]];
    if (!field || !args[index + 1] || args[index + 1].startsWith("--"))
      throw new Error("Expected --target <target> or --output <directory>.");
    options[field] = args[index + 1];
  }
  console.log(await buildHostServiceLauncher(options));
}
