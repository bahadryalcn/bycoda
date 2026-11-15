import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./tunnel-providers", () => ({ tunnelExecutable: vi.fn(async () => undefined) }));
import { tunnelExecutable } from "./tunnel-providers";
import { installCloudflared, verifyCloudflared, CLOUDFLARED_VERSION } from "./cloudflared-install";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("pinned cloudflared installation", () => {
  it("prefers PATH without downloading", async () => {
    vi.mocked(tunnelExecutable).mockResolvedValueOnce("/existing/cloudflared");
    const download = vi.fn();
    vi.stubGlobal("fetch", download);
    expect(await installCloudflared("unused")).toBe("/existing/cloudflared");
    expect(download).not.toHaveBeenCalled();
  });
  it("accepts exact bytes and rejects a changed release", () => {
    const bytes = Buffer.from("release");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    expect(() => verifyCloudflared(bytes, checksum)).not.toThrow();
    expect(() => verifyCloudflared(Buffer.from("changed"), checksum)).toThrow(
      "checksum verification failed",
    );
  });
  it("never installs or executes bytes after checksum failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-cloudflared-"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("tampered executable")),
    );
    try {
      await expect(installCloudflared(directory)).rejects.toThrow("checksum verification failed");
      expect(await readdir(join(directory, CLOUDFLARED_VERSION))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
