import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BrowserRuntime, BROWSER_RUNTIME_VERSION } from "./browser-runtime";

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
    chromium: { executablePath: () => executable, launch: vi.fn() },
  }));
  const runtime = new BrowserRuntime(directory, {
    npmCliPath: join(directory, "npm-cli.js"),
    command,
    load,
  });
  return { directory, executable, command, load, runtime };
}

describe("optional shared browser runtime", () => {
  it("never downloads during status or open and reports absent setup", async () => {
    const { command, runtime } = await fixture();
    expect(await runtime.status()).toMatchObject({ installed: false, installing: false });
    await expect(runtime.load()).rejects.toThrow("Set up host browser");
    expect(command).not.toHaveBeenCalled();
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
