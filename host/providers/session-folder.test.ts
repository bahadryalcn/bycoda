import { mkdtemp, rm, mkdir, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isLocalAbsoluteFolder, resolveSessionCwd, sessionFolderPath } from "./session-folder";

describe("resolveSessionCwd", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "session-folder-"));
    await mkdir(join(home, ".bycoda-host"), { recursive: true });
  });
  afterEach(() => rm(home, { recursive: true, force: true }));

  it("uses home when nothing is configured", async () => {
    expect(await resolveSessionCwd("~", home)).toBe(home);
  });

  it("creates separate stable scratch directories and rejects traversal", async () => {
    const first = "~/.bycoda-host/scratch/session-00000000-0000-4000-8000-000000000001";
    const second = "~/.bycoda-host/scratch/session-quick_launch_2";
    const path = await resolveSessionCwd(first, home);
    expect(path).toBe(join(home, first.slice(2)));
    expect(await resolveSessionCwd(first, home)).toBe(path);
    expect(await resolveSessionCwd(second, home)).not.toBe(path);
    expect((await stat(path!)).isDirectory()).toBe(true);
    await expect(
      resolveSessionCwd("~/.bycoda-host/scratch/session-../elsewhere", home),
    ).rejects.toThrow("Invalid session scratch directory");
  });

  it("creates and returns the configured folder", async () => {
    const folder = join(home, "work", "scratch");
    await writeFile(sessionFolderPath(home), JSON.stringify({ folder }));
    expect(await resolveSessionCwd("~", home)).toBe(folder);
    expect((await stat(folder)).isDirectory()).toBe(true);
  });

  it("falls back to home for a relative or corrupt choice", async () => {
    await writeFile(sessionFolderPath(home), JSON.stringify({ folder: "relative/x" }));
    expect(await resolveSessionCwd("~", home)).toBe(home);
    await writeFile(sessionFolderPath(home), "{nope");
    expect(await resolveSessionCwd("~", home)).toBe(home);
  });

  it("leaves other paths untouched", async () => {
    const folder = join(home, "elsewhere");
    await writeFile(sessionFolderPath(home), JSON.stringify({ folder }));
    expect(await resolveSessionCwd("~/x", home)).toBeUndefined();
    expect(await resolveSessionCwd("/tmp/p", home)).toBeUndefined();
    await expect(stat(folder)).rejects.toThrow();
  });

  it("rejects remote and UNC folders", () => {
    expect(isLocalAbsoluteFolder("ssh://host/x")).toBe(false);
    expect(isLocalAbsoluteFolder("//server/share")).toBe(false);
    expect(isLocalAbsoluteFolder("\\\\server\\share")).toBe(false);
    expect(isLocalAbsoluteFolder(join(home, "ok"))).toBe(true);
  });
});
