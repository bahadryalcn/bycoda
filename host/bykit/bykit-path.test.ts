import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { bykitAvailable, resetBykitCache } from "./bykit-hint";
import { bundledBykitPath, bundledBykitVersion, withBundledBykit } from "./bykit-path";

const folders: string[] = [];
function hostFolder(bundled: boolean, name = process.platform === "win32" ? "bykit.exe" : "bykit") {
  const folder = mkdtempSync(join(tmpdir(), "bykit-path-"));
  folders.push(folder);
  if (bundled) {
    mkdirSync(join(folder, "bin"));
    writeFileSync(join(folder, "bin", name), "");
    writeFileSync(join(folder, "version.json"), JSON.stringify({ bykitVersion: "0.2.0" }));
  }
  return folder;
}
beforeEach(resetBykitCache);
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

it("counts the bundled binary when PATH has none", async () => {
  const folder = hostFolder(true);
  expect(
    await bykitAvailable(
      async () => undefined,
      undefined,
      () => bundledBykitPath(folder),
    ),
  ).toBe(true);
  expect(bundledBykitVersion(folder)).toBe("0.2.0");
});

it("counts a PATH-only bykit and reports absent when neither exists", async () => {
  const folder = hostFolder(false);
  expect(
    await bykitAvailable(
      async () => "/usr/bin/bykit",
      undefined,
      () => bundledBykitPath(folder),
    ),
  ).toBe(true);
  resetBykitCache();
  expect(
    await bykitAvailable(
      async () => undefined,
      undefined,
      () => bundledBykitPath(folder),
    ),
  ).toBe(false);
  expect(bundledBykitVersion(folder)).toBeUndefined();
});

it("counts bykit when both exist", async () => {
  const folder = hostFolder(true);
  expect(
    await bykitAvailable(
      async () => "/usr/bin/bykit",
      undefined,
      () => bundledBykitPath(folder),
    ),
  ).toBe(true);
});

it("puts the bundled directory ahead of the user's PATH", () => {
  const folder = hostFolder(true, "bykit");
  const env = withBundledBykit({ PATH: "/usr/bin" }, folder, "linux");
  expect(env.PATH).toBe(`${join(folder, "bin")}:/usr/bin`);
});

it("keeps Windows Path spelling and merges duplicates case-insensitively", () => {
  const folder = hostFolder(true, "bykit.exe");
  const env = withBundledBykit({ Path: "C:\\Windows", PATH: "C:\\Other" }, folder, "win32");
  expect(env.Path).toBe(`${join(folder, "bin")};C:\\Windows`);
  expect(Object.keys(env).filter((key) => key.toUpperCase() === "PATH")).toEqual(["Path"]);
});

it("leaves the environment alone without a bundle", () => {
  const env = withBundledBykit({ PATH: "/usr/bin" }, hostFolder(false), "linux");
  expect(env).toEqual({ PATH: "/usr/bin" });
});
