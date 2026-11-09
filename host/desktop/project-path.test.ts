import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeProjectPath, sameProjectPath } from "./project-path";

const folders: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function retargetable() {
  const folder = mkdtempSync(join(tmpdir(), "bycoda-project-path-"));
  folders.push(folder);
  const a = join(folder, "a"),
    b = join(folder, "b"),
    alias = join(folder, "alias");
  mkdirSync(a);
  mkdirSync(b);
  const link = (target: string) =>
    symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
  link(a);
  return { a, b, alias, link };
}

describe("normalizeProjectPath", () => {
  it("refreshes an expired path off the event loop and serves the known value meanwhile", async () => {
    const { a, b, alias, link } = retargetable();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    expect(normalizeProjectPath(alias)).toBe(normalizeProjectPath(a));
    unlinkSync(alias);
    link(b);
    clock.mockReturnValue(now + 6_000);
    // A synchronous realpath here would block every Host request; the expired
    // value is returned and one asynchronous refresh is started instead.
    expect(normalizeProjectPath(alias)).toBe(normalizeProjectPath(a));
    await vi.waitFor(() => expect(normalizeProjectPath(alias)).toBe(normalizeProjectPath(b)));
  });

  it("compares a missing folder as written", () => {
    const missing = join(tmpdir(), "bycoda-project-path-missing", "Proj\\");
    expect(normalizeProjectPath(missing, "linux")).toBe(
      missing.replace(/\\/g, "/").replace(/\/+$/, ""),
    );
  });
});

describe("sameProjectPath", () => {
  it("matches equal spellings without a filesystem lookup and differing ones by identity", () => {
    const { a, alias } = retargetable();
    expect(sameProjectPath("Z:/never/resolved", "Z:/never/resolved")).toBe(true);
    expect(sameProjectPath(alias, a)).toBe(true);
    expect(sameProjectPath(alias, join(a, "..", "b"))).toBe(false);
  });
});
