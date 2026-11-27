import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { closeSync, existsSync, openSync } from "node:fs";

/**
 * The one place that pins the bundled bykit CLI (https://github.com/bahadryalcn/bykit).
 * Bump `version` and every sha256 together from the release's SHA256SUMS file.
 * A value that is not 64 hex characters fails packaging loudly.
 */
export const BYKIT_PIN = Object.freeze({
  version: "0.2.2",
  repository: "https://github.com/bahadryalcn/bykit",
  // Host target -> release target triple and the sha256 of the release archive.
  targets: {
    "darwin-arm64": {
      triple: "aarch64-apple-darwin",
      sha256: "90e87888b2ecd563a59fcb0c5983f414bb362286244ba481df6964adba9dfc90",
    },
    "darwin-x64": {
      triple: "x86_64-apple-darwin",
      sha256: "586baac6f85a169ef144cfb5086b6a3e1f8cb7f5b31acbee117eae2a71a7cbde",
    },
    "linux-x64": {
      triple: "x86_64-unknown-linux-gnu",
      sha256: "e208d2f81ec4bd36e22b5efde785255aea3300298fc72e4ee8648744afc1528b",
    },
    "win32-x64": {
      triple: "x86_64-pc-windows-msvc",
      sha256: "cc44aa6bfd021f97b1b4cf07cd2b7b0fcfb755bc283179d6f0bbb2e36bdd5b23",
    },
  },
});

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Release asset name and URL for one Host target. */
export function bykitAsset(target, pin = BYKIT_PIN) {
  const entry = pin.targets[target];
  if (!entry) throw new Error(`bykit has no release for host target ${target}`);
  const windows = target.startsWith("win32-");
  const name = `bykit-v${pin.version}-${entry.triple}.${windows ? "zip" : "tar.gz"}`;
  return {
    name,
    windows,
    sha256: entry.sha256,
    url: `${pin.repository}/releases/download/v${pin.version}/${name}`,
  };
}

function requireChecksum(asset) {
  if (!/^[a-f0-9]{64}$/.test(asset.sha256))
    throw new Error(
      `The bykit checksum for ${asset.name} is a placeholder; fill scripts/setup/bykit.mjs from the release SHA256SUMS before packaging.`,
    );
}

/** Download (or reuse) the pinned archive; every byte is verified against the pin. */
export async function readBykitArchive({ target, cacheRoot, pin = BYKIT_PIN, fetcher = fetch }) {
  const asset = bykitAsset(target, pin);
  requireChecksum(asset);
  const directory = resolve(cacheRoot ?? join(homedir(), ".bycoda-build", "helpers"), "bykit");
  await mkdir(directory, { recursive: true });
  const path = join(directory, asset.name);
  let bytes = await readFile(path).catch(() => undefined);
  if (!bytes || hash(bytes) !== asset.sha256) {
    const response = await fetcher(asset.url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`bykit download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== asset.sha256) throw new Error("bykit checksum mismatch");
    await writeFile(path, bytes);
  }
  return { ...asset, path };
}

async function findBinary(directory, name) {
  for (const entry of await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  }))
    if (entry.isFile() && entry.name === name) return join(entry.parentPath, entry.name);
  throw new Error(`The bykit archive has no ${name}`);
}

function windowsTar() {
  const system = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  return existsSync(system) ? system : "tar";
}

/** Extract the verified archive and place the binary at <folder>/bin/bykit[.exe]. */
export async function copyBykit(options) {
  const { target, folder } = options;
  const archive = await readBykitArchive(options);
  const name = archive.windows ? "bykit.exe" : "bykit";
  const scratch = await mkdtemp(join(folder, ".bykit-"));
  try {
    if (archive.windows)
      if (process.platform === "win32")
        // Windows' own bsdtar reads zip; a GNU tar earlier on PATH (Git) takes "C:" for a host.
        execFileSync(windowsTar(), ["-xf", archive.path, "-C", scratch], {
          windowsHide: true,
        });
      else execFileSync("unzip", ["-q", archive.path, "-d", scratch]);
    else {
      // Stdin avoids GNU tar reading a drive letter as a remote host; no strip, the layout is unknown.
      const input = openSync(archive.path, "r");
      try {
        execFileSync("tar", ["-xzf", "-"], {
          cwd: scratch,
          windowsHide: true,
          stdio: [input, "pipe", "pipe"],
        });
      } finally {
        closeSync(input);
      }
    }
    const source = await findBinary(scratch, name);
    const destination = join(folder, "bin", name);
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
    if (!archive.windows) await chmod(destination, 0o755);
    return {
      path: destination,
      version: options.pin?.version ?? BYKIT_PIN.version,
      target,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
