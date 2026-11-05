import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, fstatSync, lstatSync, type Stats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  NativeGuardianChild,
  ProviderGuardianError,
  type GuardianLaunch,
} from "./provider-guardian.ts";

const MAX_EXECUTABLE = 64 * 1024 * 1024;
const MAX_MANIFEST = 64 * 1024;
const triples: Record<string, string> = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
};
const fields = new Set([
  "protocolVersion",
  "target",
  "rustTarget",
  "artifact",
  "size",
  "rawSha256",
  "sourceFingerprint",
  "buildIdentity",
]);

function identity(stat: Stats): string {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
}

export type PreparedGuardian = {
  supportsBuildReceipt(): Promise<boolean>;
  supportsTunnelCustody(): Promise<boolean>;
  spawn(
    launch: GuardianLaunch,
    beforeStart?: () => Promise<void>,
    commitStart?: () => void,
  ): NativeGuardianChild;
  dispose(): Promise<void>;
};

/** Fixed local installation input only. It grants no provider/application authority.
 * A missing, corrupt, mismatched or unsupported bundle yields undefined (warned), so
 * the caller falls back to the plain provider-guard spawn. */
export async function prepareProviderGuardian(
  directory: string,
  options?: { allowLinuxOriginalChild?: boolean },
): Promise<PreparedGuardian | undefined> {
  let executable: FileHandle | undefined;
  const unavailable = () =>
    new ProviderGuardianError("Provider guardian installation is unavailable.");
  try {
    const base = resolve(directory);
    const manifestPath = join(base, "provider-guardian.json");
    const manifestStat = await lstat(manifestPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!manifestStat) return undefined;
    if (
      !manifestStat.isFile() ||
      manifestStat.isSymbolicLink() ||
      manifestStat.size > MAX_MANIFEST ||
      (await realpath(base)) !== base
    )
      throw unavailable();
    const metadata = await open(manifestPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let json: Buffer;
    let manifestIdentity: string;
    try {
      const info = await metadata.stat();
      if (!info.isFile() || info.size > MAX_MANIFEST) throw unavailable();
      const buffer = Buffer.alloc(MAX_MANIFEST + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await metadata.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (
        offset > MAX_MANIFEST ||
        offset !== info.size ||
        identity(info) !== identity(await metadata.stat())
      )
        throw unavailable();
      json = buffer.subarray(0, offset);
      manifestIdentity = identity(info);
    } finally {
      await metadata.close();
    }
    const value: unknown = JSON.parse(json.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
    const manifest = value as Record<string, unknown>;
    const target = `${process.platform}-${process.arch}`;
    const artifact =
      process.platform === "win32" ? "bycoda-provider-guardian.exe" : "bycoda-provider-guardian";
    if (
      Object.keys(manifest).length !== fields.size ||
      Object.keys(manifest).some((key) => !fields.has(key)) ||
      manifest.protocolVersion !== 1 ||
      manifest.target !== target ||
      manifest.rustTarget !== triples[target] ||
      manifest.artifact !== artifact ||
      !Number.isSafeInteger(manifest.size) ||
      Number(manifest.size) < 1 ||
      Number(manifest.size) > MAX_EXECUTABLE ||
      typeof manifest.rawSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(manifest.rawSha256) ||
      typeof manifest.sourceFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(manifest.sourceFingerprint) ||
      !(
        manifest.buildIdentity === null ||
        (typeof manifest.buildIdentity === "object" && !Array.isArray(manifest.buildIdentity))
      )
    )
      throw unavailable();
    // Unix original-child ownership is not descendant containment. Do not enable
    // a packaged stronger lifecycle contract on a platform that cannot supply it.
    if (
      process.platform !== "win32" &&
      !(process.platform === "linux" && options?.allowLinuxOriginalChild)
    )
      throw unavailable();
    const path = join(base, artifact);
    const link = await lstat(path);
    if (!link.isFile() || link.isSymbolicLink() || link.size !== manifest.size) throw unavailable();
    executable = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await executable.stat();
    if (!before.isFile() || before.size !== manifest.size || identity(link) !== identity(before))
      throw unavailable();
    const digest = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < before.size + 1) {
      const { bytesRead } = await executable.read(
        buffer,
        0,
        Math.min(buffer.length, before.size + 1 - offset),
        offset,
      );
      if (!bytesRead) break;
      if (
        offset === 0 &&
        (process.platform === "win32"
          ? bytesRead < 2 || buffer[0] !== 77 || buffer[1] !== 90
          : bytesRead < 4 || !buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))
      )
        throw unavailable();
      digest.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (
      offset !== before.size ||
      digest.digest("hex") !== manifest.rawSha256 ||
      identity(await executable.stat()) !== identity(before)
    )
      throw unavailable();
    const original = executable;
    executable = undefined;
    let used = false;
    let disposed = false;
    return {
      async supportsTunnelCustody() {
        if (disposed || !["win32", "linux"].includes(process.platform)) return false;
        try {
          const result = await new Promise<boolean>((done) => {
            execFile(
              path,
              ["--tunnel-custody-capability"],
              { windowsHide: true, timeout: 3_000, maxBuffer: 1024 },
              (error, stdout) => done(!error && stdout.trim() === "bycoda-tunnel-custody-v1"),
            );
          });
          return (
            result &&
            identity(lstatSync(path)) === identity(before) &&
            identity(fstatSync(original.fd)) === identity(before)
          );
        } catch {
          return false;
        }
      },
      async supportsBuildReceipt() {
        if (disposed || process.platform !== "win32") return false;
        try {
          const result = await new Promise<boolean>((done) => {
            execFile(
              path,
              ["--build-receipt-capability"],
              { windowsHide: true, timeout: 3_000, maxBuffer: 1024 },
              (error, stdout) => done(!error && stdout.trim() === "bycoda-build-receipt-v1"),
            );
          });
          return (
            result &&
            identity(lstatSync(path)) === identity(before) &&
            identity(fstatSync(original.fd)) === identity(before)
          );
        } catch {
          return false;
        }
      },
      spawn(launch, beforeStart, commitStart) {
        if (used || disposed) throw unavailable();
        used = true;
        const current = lstatSync(path);
        const metadataNow = lstatSync(manifestPath);
        if (
          !current.isFile() ||
          current.isSymbolicLink() ||
          metadataNow.isSymbolicLink() ||
          identity(current) !== identity(before) ||
          identity(fstatSync(original.fd)) !== identity(before) ||
          identity(metadataNow) !== manifestIdentity
        )
          throw unavailable();
        return new NativeGuardianChild(path, launch, beforeStart, commitStart);
      },
      async dispose() {
        if (!disposed) {
          disposed = true;
          await original.close();
        }
      },
    };
  } catch (error) {
    await executable?.close().catch(() => {});
    // A stale or mismatched bundle must not stop providers: fall back to the plain guard.
    console.warn("Provider guardian bundle is unusable; falling back to the plain guard:", error);
    return undefined;
  }
}
