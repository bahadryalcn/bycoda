import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileAtomic } from "../storage/atomic-write";
import { tunnelExecutable } from "./tunnel-providers";

export const CLOUDFLARED_VERSION = "2026.1.2";
// Official release checksums: github.com/cloudflare/cloudflared/releases/tag/2026.1.2.
const RELEASES: Record<string, [string, string]> = {
  "win32-x64": [
    "cloudflared-windows-amd64.exe",
    "6304f5e1c017c038fb74a02c0157b2b63d4bc1f15709c639fcc08cb6dbe4c126",
  ],
  "win32-arm64": [
    "cloudflared-windows-amd64.exe",
    "6304f5e1c017c038fb74a02c0157b2b63d4bc1f15709c639fcc08cb6dbe4c126",
  ],
  "linux-x64": [
    "cloudflared-linux-amd64",
    "e157c54e929cc289cbd53860453168c2fe3439eb55e2e965a56579252585d9c1",
  ],
  "linux-arm64": [
    "cloudflared-linux-arm64",
    "1362498b9975e018f290cc4412af61391cca65cccbc06f2d8b128324ae9a18ef",
  ],
  "darwin-x64": [
    "cloudflared-darwin-amd64.tgz",
    "f7726beb912ad3314e11f95719f8b303502e8e4932b810732ba9ef2330bd0848",
  ],
  "darwin-arm64": [
    "cloudflared-darwin-arm64.tgz",
    "f450d90e86129dac1fab1f35ee185eb02b0e23bef3e3dcfb0ce45c48fad70390",
  ],
};

export function verifyCloudflared(bytes: Uint8Array, checksum: string): void {
  if (createHash("sha256").update(bytes).digest("hex") !== checksum)
    throw new Error("Cloudflared checksum verification failed");
}

/** PATH wins. Only checksum-pinned bytes may become an executable in Host data. */
export async function installCloudflared(directory: string): Promise<string> {
  const existing = await tunnelExecutable("cloudflare");
  if (existing) return existing;
  const release = RELEASES[`${process.platform}-${process.arch}`];
  if (!release) throw new Error("Unsupported cloudflared platform");
  const [asset, checksum] = release;
  const target = join(directory, CLOUDFLARED_VERSION);
  await mkdir(target, { recursive: true, mode: 0o700 });
  const archive = join(target, asset);
  let bytes: Buffer;
  try {
    bytes = await readFile(archive);
    verifyCloudflared(bytes, checksum);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const response = await fetch(
      `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset}`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok) throw new Error("Cloudflared download failed");
    bytes = Buffer.from(await response.arrayBuffer());
    verifyCloudflared(bytes, checksum);
    await writeFileAtomic(archive, bytes, { mode: 0o700 });
  }
  if (!asset.endsWith(".tgz")) {
    await chmod(archive, 0o700);
    return archive;
  }
  const staging = await mkdtemp(join(target, "extract-"));
  try {
    await promisify(execFile)("tar", ["-xzf", archive, "-C", staging, "cloudflared"], {
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    const executable = join(target, "cloudflared");
    await writeFileAtomic(executable, await readFile(join(staging, "cloudflared")), {
      mode: 0o700,
    });
    await chmod(executable, 0o700);
    return executable;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
