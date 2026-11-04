import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve } from "node:path";

const UV_VERSION = "0.13.5";
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
// Official release digests: https://api.github.com/repos/astral-sh/uv/releases/tags/0.13.5
const ASSETS: Record<string, { target: string; sha256: string }> = {
  "win32-x64": {
    target: "x86_64-pc-windows-msvc",
    sha256: "a38b8d1902b7cfbc76b423ba1bb456f623f42064cdc72628b6075b89afd1019a",
  },
  "win32-arm64": {
    target: "aarch64-pc-windows-msvc",
    sha256: "09f47edf90726084a70f9426f6e3ca4f46e9bf7cbf23b1716ec64d60b055fae3",
  },
  "darwin-x64": {
    target: "x86_64-apple-darwin",
    sha256: "b0f52b0e3945b4107d89024ea38e625683011fbfc05a0d98f9fa2d6dcee28c66",
  },
  "darwin-arm64": {
    target: "aarch64-apple-darwin",
    sha256: "743f85035a1996ecb350659e01cd9faea9709829be09b1b4b03c73eaf3c9cd73",
  },
  "linux-x64": {
    target: "x86_64-unknown-linux-gnu",
    sha256: "f68d291c75783122dad58ab77def0e13f3233f358731db5d6d7e8715603b928f",
  },
  "linux-arm64": {
    target: "aarch64-unknown-linux-gnu",
    sha256: "4bb69cf95ed13f23713bb7bc09f241896ea0c75b7c557e615a20604b82f9c403",
  },
};

export type VoicePythonRun = (
  program: string,
  args: string[],
  signal: AbortSignal,
) => Promise<string>;
export type VoicePythonInstallOptions = {
  directory: string;
  signal: AbortSignal;
  run: VoicePythonRun;
  platform?: NodeJS.Platform;
  arch?: string;
};

function contained(root: string, value: string) {
  const path = relative(root, value);
  if (
    path === ".." ||
    path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(path)
  )
    throw new Error("The private Python installation path is unavailable.");
  return value;
}

async function directory(root: string, value: string) {
  contained(root, value);
  await mkdir(value, { recursive: true });
  return contained(root, await realpath(value));
}

async function download(url: string, signal: AbortSignal): Promise<Buffer> {
  const timeout = AbortSignal.timeout(120_000);
  const response = await fetch(url, { signal: AbortSignal.any([signal, timeout]) });
  if (!response.ok || !response.body)
    throw new Error("Python support could not be downloaded. Check your connection and try again.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_ARCHIVE_BYTES) throw new Error("The Python support download is too large.");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

async function installedPython(pythonDirectory: string, platform: NodeJS.Platform) {
  const entries = await readdir(pythonDirectory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) =>
    b.name.localeCompare(a.name, undefined, { numeric: true }),
  )) {
    if (!entry.isDirectory() || !/^cpython-3\.12\.[\w.-]+$/.test(entry.name)) continue;
    const executable = join(
      pythonDirectory,
      entry.name,
      ...(platform === "win32" ? ["python.exe"] : ["bin", "python3.12"]),
    );
    const candidate = await realpath(executable).catch(() => undefined);
    if (candidate && (await lstat(candidate)).isFile())
      return contained(pythonDirectory, candidate);
  }
}

/** Explicit Install only. Downloads a checksum-pinned tool, never an evaluated
 * installer script, and installs Python without PATH, registry or system changes.
 * `run` must be shell-free, hidden, bounded and AbortSignal-aware (voice setup's runner).
 */
export async function ensureVoicePython(options: VoicePythonInstallOptions): Promise<string> {
  const { signal, run } = options;
  signal.throwIfAborted();
  const platform = options.platform ?? process.platform;
  const asset = ASSETS[`${platform}-${options.arch ?? process.arch}`];
  if (!asset)
    throw new Error(
      "Automatic Python setup is unavailable on this computer. Choose Python 3.10–3.12.",
    );
  const requestedRoot = resolve(options.directory);
  if (!isAbsolute(options.directory) || requestedRoot === parse(requestedRoot).root)
    throw new Error("The private Python installation path is unavailable.");
  await mkdir(requestedRoot, { recursive: true });
  const root = await realpath(requestedRoot);
  const cache = await directory(root, join(root, "python-bootstrap"));
  const pythonDirectory = await directory(root, join(root, "python"));
  const installed = await installedPython(pythonDirectory, platform);
  if (installed) return installed;
  const filename = `uv-${asset.target}.${platform === "win32" ? "zip" : "tar.gz"}`;
  const archive = join(cache, `${UV_VERSION}-${filename}`);
  let bytes: Buffer | undefined;
  const stat = await lstat(archive).catch(() => undefined);
  if (stat?.isSymbolicLink())
    throw new Error("The private Python installation path is unavailable.");
  if (stat?.isFile() && stat.size <= MAX_ARCHIVE_BYTES) bytes = await readFile(archive);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
    bytes = await download(
      `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${filename}`,
      signal,
    );
    if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
      throw new Error("Python support download verification failed. Try again.");
    signal.throwIfAborted();
    const temporary = join(cache, `${randomUUID()}.download`);
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, archive);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  const staging = await directory(root, join(cache, `extract-${randomUUID()}`));
  try {
    signal.throwIfAborted();
    await run("tar", ["-xf", archive, "-C", staging], signal);
    const uv = join(staging, ...(platform === "win32" ? ["uv.exe"] : [`uv-${asset.target}`, "uv"]));
    contained(staging, await realpath(uv));
    signal.throwIfAborted();
    await run(
      uv,
      [
        "python",
        "install",
        "3.12",
        "--install-dir",
        pythonDirectory,
        "--no-bin",
        "--no-registry",
        "--no-config",
      ],
      signal,
    );
    signal.throwIfAborted();
    const prepared = await installedPython(pythonDirectory, platform);
    if (prepared) return prepared;
    throw new Error("Private Python could not be prepared. Try again or choose Python 3.10–3.12.");
  } finally {
    // This unique, verified child contains only this invocation's extracted tool.
    contained(cache, staging);
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
