import { expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearProviderResolution, providerLaunch, resolveProvider } from "./process";

it("resolves the Antigravity CLI without requiring the separate ACP server", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-agy-resolve-"));
  const candidate = join(directory, process.platform === "win32" ? "agy.exe" : "agy");
  writeFileSync(candidate, "fixture");
  chmodSync(candidate, 0o755);
  vi.stubEnv("PATH", directory);
  clearProviderResolution();
  try {
    expect(await resolveProvider("antigravity")).toBe(candidate);
  } finally {
    clearProviderResolution();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});

it.each(["bundle/gemini.js", "dist/index.js"])(
  "launches the Gemini Windows npm package at %s without interpreting a shell wrapper",
  async (relative) => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-gemini-launch-"));
    const launcher = join(directory, "gemini.cmd");
    const entry = join(directory, "node_modules/@google/gemini-cli", relative);
    mkdirSync(join(entry, ".."), { recursive: true });
    writeFileSync(entry, "// fixture");
    writeFileSync(launcher, "@echo wrapper must not execute");
    try {
      expect(await providerLaunch(launcher, ["--experimental-acp"], "win32")).toEqual({
        command: process.execPath,
        args: [entry, "--experimental-acp"],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.each(["cursor", "pi", "fx"] as const)(
  "does not execute an unrelated ambiguous %s binary while resolving providers",
  async (provider) => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-provider-identity-"));
    const name = provider === "cursor" ? "agent" : provider;
    const candidate = join(directory, name);
    const sentinel = join(directory, "executed");
    writeFileSync(candidate, `#!/bin/sh\nprintf bad > '${sentinel}'\n`);
    chmodSync(candidate, 0o755);
    vi.stubEnv("PATH", directory);
    try {
      let resolved: string | undefined;
      try {
        resolved = await resolveProvider(provider);
      } catch {
        /* no matching provider is expected on CI */
      }
      expect(resolved).not.toBe(candidate);
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.runIf(process.platform !== "win32")(
  "recognizes a Cursor agent shim without executing it",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-cursor-identity-"));
    const targetDirectory = join(directory, "cursor-agent-package");
    const target = join(targetDirectory, "cursor-agent");
    const candidate = join(directory, "agent");
    const sentinel = join(directory, "executed");
    mkdirSync(targetDirectory);
    writeFileSync(target, `#!/bin/sh\nprintf bad > '${sentinel}'\n`);
    chmodSync(target, 0o755);
    symlinkSync(target, candidate);
    vi.stubEnv("PATH", directory);
    try {
      expect(await resolveProvider("cursor")).toBe(candidate);
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.each(["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"])(
  "launches the supported Pi npm shim for %s without a shell",
  async (name) => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-pi-npm-"));
    const launcher = join(directory, "pi.cmd");
    const packageRoot = join(directory, "node_modules", name);
    const entry = join(packageRoot, "dist/cli.js");
    mkdirSync(join(entry, ".."), { recursive: true });
    writeFileSync(launcher, "@echo wrapper must not execute");
    writeFileSync(entry, "// thin launcher");
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name, bin: { pi: "dist/cli.js" } }),
    );
    try {
      expect(await providerLaunch(launcher, ["--mode", "rpc"], "win32")).toEqual({
        command: process.execPath,
        args: [entry, "--mode", "rpc"],
      });
      writeFileSync(
        join(packageRoot, "package.json"),
        JSON.stringify({ name, bin: { pi: "../../../outside.js" } }),
      );
      await expect(providerLaunch(launcher, [], "win32")).rejects.toThrow("Missing Pi");
      writeFileSync(
        join(packageRoot, "package.json"),
        JSON.stringify({ name: "unrelated", bin: { pi: "dist/cli.js" } }),
      );
      await expect(providerLaunch(launcher, [], "win32")).rejects.toThrow("Missing Pi");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.runIf(process.platform !== "win32")(
  "recognizes a thin Pi npm symlink by its package manifest",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-pi-identity-"));
    const packageRoot = join(directory, "package");
    const entry = join(packageRoot, "dist/cli.js");
    const candidate = join(directory, "pi");
    mkdirSync(join(entry, ".."), { recursive: true });
    writeFileSync(entry, "#!/usr/bin/env node\n// thin stub\n");
    chmodSync(entry, 0o755);
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "@earendil-works/pi-coding-agent" }),
    );
    symlinkSync(entry, candidate);
    vi.stubEnv("PATH", directory);
    try {
      expect(await resolveProvider("pi")).toBe(candidate);
      writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "unrelated" }));
      await expect(resolveProvider("pi")).rejects.toThrow("not installed");
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it("remembers a resolved provider but notices when its launcher is gone", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-provider-cache-"));
  const candidate = join(directory, process.platform === "win32" ? "codex.exe" : "codex");
  writeFileSync(candidate, "#!/bin/sh\n");
  chmodSync(candidate, 0o755);
  vi.stubEnv("PATH", directory);
  clearProviderResolution();
  try {
    expect(await resolveProvider("codex")).toBe(candidate);
    // Same answer from memory, even with PATH entries that no longer matter.
    expect(await resolveProvider("codex")).toBe(candidate);
    rmSync(candidate);
    const fallback = await resolveProvider("codex").catch(() => undefined);
    expect(fallback).not.toBe(candidate);
    // A real install outside PATH (for example %APPDATA%\npm) is remembered instead.
    if (fallback === undefined) {
      writeFileSync(candidate, "#!/bin/sh\n# reinstalled\n");
      chmodSync(candidate, 0o755);
      expect(await resolveProvider("codex")).toBe(candidate);
    }
  } finally {
    clearProviderResolution();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});
