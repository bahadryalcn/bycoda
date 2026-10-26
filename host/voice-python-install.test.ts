import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ensureVoicePython } from "./voice-python-install";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-python-"));
  directories.push(directory);
  return {
    directory,
    signal: new AbortController().signal,
    run: vi.fn(async () => ""),
    platform: "win32" as const,
    arch: "x64",
  };
}
it("reuses only a contained private interpreter without fetching or executing installers", async () => {
  const options = await fixture();
  const interpreter = join(
    options.directory,
    "python",
    "cpython-3.12.14-windows-x86_64-none",
    "python.exe",
  );
  await mkdir(join(interpreter, ".."), { recursive: true });
  await writeFile(interpreter, "private interpreter fixture");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(await ensureVoicePython(options)).toBe(interpreter);
  expect(fetcher).not.toHaveBeenCalled();
  expect(options.run).not.toHaveBeenCalled();
});
it("rejects corrupted download bytes before extracting or executing them", async () => {
  const options = await fixture();
  const fetcher = vi.fn(
    async (_url: string, _options: unknown) => new Response("not the official archive"),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(ensureVoicePython(options)).rejects.toThrow("verification failed");
  expect(options.run).not.toHaveBeenCalled();
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://github.com/astral-sh/uv/releases/download/0.13.5/uv-x86_64-pc-windows-msvc.zip",
  );
});
it("bounds a streaming download before verification and execution", async () => {
  const options = await fixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(64 * 1024 * 1024 + 1));
              controller.close();
            },
          }),
        ),
    ),
  );
  await expect(ensureVoicePython(options)).rejects.toThrow("too large");
  expect(options.run).not.toHaveBeenCalled();
});
it("cancels before creating files or starting a download", async () => {
  const options = await fixture();
  const controller = new AbortController();
  controller.abort();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(ensureVoicePython({ ...options, signal: controller.signal })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  expect(options.run).not.toHaveBeenCalled();
});
it("refuses a private directory symlink that would put files outside its root", async () => {
  const options = await fixture();
  const other = await fixture();
  await writeFile(join(other.directory, "preserve.txt"), "unchanged");
  await symlink(
    other.directory,
    join(options.directory, "python"),
    process.platform === "win32" ? "junction" : "dir",
  );
  vi.stubGlobal("fetch", vi.fn());
  await expect(ensureVoicePython(options)).rejects.toThrow("path is unavailable");
  expect(options.run).not.toHaveBeenCalled();
  expect(await readFile(join(other.directory, "preserve.txt"), "utf8")).toBe("unchanged");
});
it("fails unsupported architectures without downloading an incompatible executable", async () => {
  const options = await fixture();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(ensureVoicePython({ ...options, arch: "ia32" })).rejects.toThrow(
    "unavailable on this computer",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
