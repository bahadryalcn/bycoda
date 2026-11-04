import { Readable } from "node:stream";
import { chmodSync, createReadStream, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, createReadStream: vi.fn(fs.createReadStream) };
});
import { clearProviderResolution, resolveProvider } from "./process";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-fx-resolution-"));
  const candidate = join(directory, process.platform === "win32" ? "fx.exe" : "fx");
  const bytes = Buffer.alloc(7 * 1024 * 1024, "x");
  bytes.write("vercel-labs/fx", 6 * 1024 * 1024);
  writeFileSync(candidate, bytes);
  chmodSync(candidate, 0o755);
  clearProviderResolution();
  vi.stubEnv("PATH", directory);
  vi.mocked(createReadStream).mockClear();
  return { directory, candidate, bytes, cleanup: () => {
    clearProviderResolution(); vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  } };
}

it("reuses inspected FX identity without rescanning its large launcher and rejects replacement", async () => {
  const f = fixture();
  try {
    expect(await resolveProvider("fx")).toBe(f.candidate);
    expect(createReadStream).toHaveBeenCalledTimes(1);
    expect(await Promise.all(Array.from({ length: 10 }, () => resolveProvider("fx")))).toEqual(Array(10).fill(f.candidate));
    expect(createReadStream).toHaveBeenCalledTimes(1);
    renameSync(f.candidate, join(f.directory, "original"));
    writeFileSync(f.candidate, Buffer.alloc(f.bytes.length, "x"));
    chmodSync(f.candidate, 0o755);
    const replacement = await resolveProvider("fx").catch(() => undefined);
    expect(replacement).not.toBe(f.candidate);
    expect(vi.mocked(createReadStream).mock.calls.filter(([path]) => String(path) === f.candidate)).toHaveLength(2);
  } finally { f.cleanup(); }
});

it("does not republish a remembered result when resolution is cleared during original identity read", async () => {
  const f = fixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((done) => { entered = done; });
  const gate = new Promise<void>((done) => { release = done; });
  vi.mocked(createReadStream).mockImplementationOnce(() => Readable.from((async function* () {
    entered(); await gate; yield f.bytes;
  })()) as ReturnType<typeof createReadStream>);
  try {
    const original = resolveProvider("fx");
    await started;
    clearProviderResolution();
    release();
    expect(await original).toBe(f.candidate);
    expect(await resolveProvider("fx")).toBe(f.candidate);
    expect(createReadStream).toHaveBeenCalledTimes(2);
  } finally { release(); f.cleanup(); }
});
