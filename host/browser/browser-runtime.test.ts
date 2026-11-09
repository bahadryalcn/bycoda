import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BrowserRuntime, BROWSER_RUNTIME_VERSION, type FfmpegRegistry } from "./browser-runtime";

type CommandOptions = { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number };
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-browser-runtime-"));
  directories.push(directory);
  const executable = join(directory, "chromium");
  const command = vi.fn(async (_node: string, args: string[], options: { cwd?: string }) => {
    if (args[1] === "install" && args[2] === "--no-audit") {
      const packageDirectory = join(options.cwd!, "node_modules", "playwright");
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(join(packageDirectory, "index.mjs"), "");
      await writeFile(join(packageDirectory, "cli.js"), "");
    } else await writeFile(executable, "browser");
    return "";
  });
  const load = vi.fn(async () => ({
    chromium: {
      executablePath: () => join(directory, "full-chromium-not-installed"),
      launch: vi.fn(),
      launchServer: vi.fn(async () => ({
        process: () => ({ spawnfile: executable }),
        close: async () => {},
      })),
    },
  }));
  const runtime = new BrowserRuntime(directory, {
    npmCliPath: join(directory, "npm-cli.js"),
    command,
    load,
  });
  return { directory, executable, command, load, runtime };
}

describe("optional shared browser runtime", () => {
  it("never downloads during status, and first use starts setup in the background", async () => {
    const { command, runtime } = await fixture();
    expect(await runtime.status()).toMatchObject({ installed: false, installing: false });
    expect(command).not.toHaveBeenCalled();
    await expect(runtime.load()).rejects.toThrow("installing automatically");
    expect((await runtime.status()).installing).toBe(true);
    await runtime.setup();
    expect(command).toHaveBeenCalledTimes(2);
    expect(command.mock.calls[1][1].slice(1)).toEqual([
      "install",
      "--only-shell",
      "chromium",
      "ffmpeg",
    ]);
    await expect(runtime.load()).resolves.toHaveProperty("chromium");
  });

  it("shares explicit setup, pins the package and survives a new host runtime", async () => {
    const { directory, command, load, runtime } = await fixture();
    await Promise.all([runtime.setup(), runtime.setup()]);
    expect(command).toHaveBeenCalledTimes(2);
    expect(command.mock.calls[0][1]).toContain("--ignore-scripts");
    const cache = join(directory, "tools", `playwright-${BROWSER_RUNTIME_VERSION}`);
    expect(JSON.parse(await readFile(join(cache, "package.json"), "utf8")).dependencies).toEqual({
      playwright: BROWSER_RUNTIME_VERSION,
    });
    const updatedHost = new BrowserRuntime(directory, { command, load });
    expect(await updatedHost.status()).toMatchObject({ installed: true, installing: false });
    await updatedHost.setup();
    expect(command).toHaveBeenCalledTimes(2);
    await expect(updatedHost.load()).resolves.toHaveProperty("chromium");
  });

  it("adds the setup hint to browser state only while the runtime is missing", async () => {
    const { runtime } = await fixture();
    const missing = await runtime.describe({ open: false });
    expect(missing).toMatchObject({
      open: false,
      runtime: { installed: false },
      setup: expect.stringContaining("installs automatically"),
    });
    await runtime.setup();
    const ready = await runtime.describe({ open: false });
    expect(ready).toMatchObject({ open: false, runtime: { installed: true } });
    expect(ready).not.toHaveProperty("setup");
  });

  it("retains failed staging directories and reports a retryable error", async () => {
    const { directory, command, runtime } = await fixture();
    command.mockRejectedValueOnce(new Error("download failed"));
    await expect(runtime.setup()).rejects.toThrow("download failed");
    expect(await runtime.status()).toMatchObject({
      installed: false,
      installing: false,
      lastError: "download failed",
    });
    const stages = await readdir(join(directory, "tools"));
    expect(stages).toHaveLength(1);
    await runtime.setup();
    expect((await readdir(join(directory, "tools"))).length).toBe(2);
    expect((await runtime.status()).lastError).toBeUndefined();
  });

  it("does not call an installed package ready when its browser binary is missing", async () => {
    const { directory, load, runtime } = await fixture();
    const cache = join(directory, "tools", `playwright-${BROWSER_RUNTIME_VERSION}`);
    const entry = join(cache, "node_modules", "playwright", "index.mjs");
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(entry, "");
    await writeFile(join(cache, ".install-complete"), BROWSER_RUNTIME_VERSION);
    expect(existsSync(entry)).toBe(true);
    expect((await runtime.status()).installed).toBe(false);
    expect(load).toHaveBeenCalledOnce();
  });

  it("finds npm in the shared parent of a packaged host runtime", async () => {
    const { directory, command, load } = await fixture();
    const npm = join(directory, "runtime", "node_modules", "npm", "bin", "npm-cli.js");
    await mkdir(dirname(npm), { recursive: true });
    await writeFile(npm, "");
    const runtime = new BrowserRuntime(directory, {
      nodePath: join(directory, "runtime", "frozen-host", "node.exe"),
      env: { PATH: "" },
      command,
      load,
    });
    await runtime.setup();
    expect(command.mock.calls[0][1][0]).toBe(npm);
  });
});

describe("pinned ffmpeg for browser recording", () => {
  /** An installed runtime whose pinned registry names `ffmpegPath` (undefined = no build here). */
  async function runtimeWithRegistry(directory: string, ffmpegPath: string | undefined) {
    const cache = join(directory, "tools", `playwright-${BROWSER_RUNTIME_VERSION}`);
    const cli = join(cache, "node_modules", "playwright", "cli.js");
    await mkdir(dirname(cli), { recursive: true });
    await writeFile(join(cache, "node_modules", "playwright", "index.mjs"), "");
    await writeFile(cli, "");
    await writeFile(join(cache, ".install-complete"), BROWSER_RUNTIME_VERSION);
    const chromium = join(directory, "chromium");
    await writeFile(chromium, "browser");
    await writeFile(join(cache, ".browser-path"), chromium);
    const command = vi.fn(async (_node: string, args: string[], _options: CommandOptions) => {
      if (args.at(-1) === "ffmpeg" && ffmpegPath) {
        await mkdir(dirname(ffmpegPath), { recursive: true });
        await writeFile(ffmpegPath, "ffmpeg");
      }
      return "";
    });
    const registry: FfmpegRegistry = {
      findExecutable: (name) =>
        name === "ffmpeg" ? { executablePath: () => ffmpegPath } : undefined,
    };
    const browsers = join(directory, "browsers");
    const runtime = new BrowserRuntime(directory, {
      command,
      loadRegistry: () => registry,
      env: { PLAYWRIGHT_BROWSERS_PATH: browsers },
    });
    return { cli, command, runtime, browsers };
  }

  it("installs the pinned ffmpeg once, in the runtime's browsers path, for an older install", async () => {
    const { directory } = await fixture();
    const ffmpeg = join(await tempBrowsers(), "ffmpeg-1013", "ffmpeg-win64.exe");
    const { cli, command, runtime, browsers } = await runtimeWithRegistry(directory, ffmpeg);
    expect(await runtime.ffmpegPath()).toBeUndefined();
    await Promise.all([runtime.ensureFfmpeg(), runtime.ensureFfmpeg()]);
    expect(command).toHaveBeenCalledTimes(1);
    const [node, args, options] = command.mock.calls[0]!;
    expect(node).toBe(process.execPath);
    expect(args).toEqual([cli, "install", "ffmpeg"]);
    expect(options).toMatchObject({
      timeoutMs: 300_000,
      env: expect.objectContaining({ PLAYWRIGHT_BROWSERS_PATH: browsers }),
    });
    expect(await runtime.ffmpegPath()).toBe(ffmpeg);
    await runtime.ensureFfmpeg();
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("does nothing when Playwright ships no ffmpeg build for this platform", async () => {
    const { directory } = await fixture();
    const { command, runtime } = await runtimeWithRegistry(directory, undefined);
    await expect(runtime.ensureFfmpeg()).resolves.toBeUndefined();
    expect(command).not.toHaveBeenCalled();
    expect(await runtime.ffmpegPath()).toBeUndefined();
  });

  it("does not guess ffmpeg for a runtime that is not installed yet", async () => {
    const { command, runtime } = await fixture();
    await expect(runtime.ensureFfmpeg()).rejects.toThrow("not installed yet");
    expect(command).not.toHaveBeenCalled();
  });

  it("fails loudly when the install exits without writing the pinned ffmpeg", async () => {
    const { directory } = await fixture();
    const { runtime, command } = await runtimeWithRegistry(
      directory,
      join(directory, "never", "ffmpeg.exe"),
    );
    command.mockImplementationOnce(async () => "");
    await expect(runtime.ensureFfmpeg()).rejects.toThrow("finished without an ffmpeg binary");
  });
});

async function tempBrowsers() {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-browser-ffmpeg-"));
  directories.push(directory);
  return directory;
}
