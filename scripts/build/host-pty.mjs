/** Ships the prebuilt PTY binding (@lydell/node-pty) beside each packaged Host bundle. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PACKAGE = "@lydell/node-pty";

/** sha512 integrity of `name@version` as pinned in the lockfile. */
export function lockedIntegrity(lockfile, name, version) {
  const escaped = `${name}@${version}`.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const match = new RegExp(`'${escaped}':\\s*\\n\\s*resolution: \\{integrity: (sha512-[A-Za-z0-9+/=]+)\\}`).exec(
    lockfile,
  );
  if (!match) throw new Error(`${name}@${version} is not pinned in pnpm-lock.yaml`);
  return match[1];
}

async function tarball(cache, name, version, integrity) {
  const file = join(cache, `${name.replace("/", "+")}-${version}.tgz`);
  const matches = (bytes) =>
    `sha512-${createHash("sha512").update(bytes).digest("base64")}` === integrity;
  let bytes;
  try {
    bytes = await readFile(file);
  } catch {
    /* first download */
  }
  if (!bytes || !matches(bytes)) {
    const base = name.split("/")[1];
    const response = await fetch(`https://registry.npmjs.org/${name}/-/${base}-${version}.tgz`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`${name} download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!matches(bytes)) throw new Error(`${name}@${version} integrity mismatch`);
    await writeFile(file, bytes);
  }
  return file;
}

/** Installs the PTY binding and its `target` prebuild into `<folder>/node_modules/@lydell`. */
export async function copyHostPty({ target, folder, cache, root = "." }) {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const version = manifest.dependencies?.[PACKAGE];
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error(`${PACKAGE} must be pinned exactly`);
  const lockfile = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
  for (const name of [PACKAGE, `${PACKAGE}-${target}`]) {
    const archive = await tarball(cache, name, version, lockedIntegrity(lockfile, name, version));
    const destination = join(folder, "node_modules", name);
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    // Archive on stdin: GNU tar would read a "G:\..." path as a remote host.
    execFileSync("tar", ["-xzf", "-", "--strip-components=1"], {
      cwd: destination,
      input: await readFile(archive),
      windowsHide: true,
    });
  }
}
