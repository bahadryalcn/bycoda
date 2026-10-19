import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { hashTaskArtifact, transferTaskArtifacts } from "./task-artifacts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function checkout() {
  const cwd = mkdtempSync(join(tmpdir(), "task-artifacts-"));
  folders.push(cwd);
  execFileSync("git", ["init", "-q", cwd], { windowsHide: true });
  writeFileSync(join(cwd, ".gitignore"), "/temp/\n");
  return cwd;
}
function output(cwd: string, path = "temp/local/inventory/result.txt", text = "verified output") {
  const file = join(cwd, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  return file;
}
it("copies ignored outputs idempotently and transfers only declared dependency paths", async () => {
  const source = checkout(),
    target = checkout(),
    dependent = checkout();
  output(source);
  output(source, "temp/verification/log.txt");
  const paths = await transferTaskArtifacts(source, target);
  expect(paths).toEqual(["temp/local/inventory/result.txt"]);
  await transferTaskArtifacts(source, target);
  output(target, "temp/local/other-session/private.txt");
  await transferTaskArtifacts(target, dependent, paths);
  expect(readFileSync(join(dependent, paths[0]), "utf8")).toBe("verified output");
  expect(existsSync(join(dependent, "temp/local/other-session/private.txt"))).toBe(false);
  expect(existsSync(join(target, "temp/verification/log.txt"))).toBe(false);
});
it("preflights collisions without overwriting owner files or copying other files", async () => {
  const source = checkout(),
    target = checkout();
  output(source, "temp/local/inventory/a.txt");
  output(source, "temp/local/inventory/result.txt");
  const owner = output(target, "temp/local/inventory/result.txt", "owner output");
  await expect(transferTaskArtifacts(source, target)).rejects.toThrow("different content");
  expect(readFileSync(owner, "utf8")).toBe("owner output");
  expect(existsSync(join(target, "temp/local/inventory/a.txt"))).toBe(false);
});
it("rejects junctions and missing or escaped dependency paths", async () => {
  const source = checkout(),
    target = checkout(),
    outside = checkout();
  output(source);
  await expect(transferTaskArtifacts(source, target, ["temp/local/../../secret"])).rejects.toThrow(
    "Invalid task artifact path",
  );
  await expect(transferTaskArtifacts(source, target, ["temp/local/missing.txt"])).rejects.toThrow(
    "incomplete",
  );
  mkdirSync(join(target, "temp"));
  symlinkSync(outside, join(target, "temp/local"), "junction");
  await expect(transferTaskArtifacts(source, target)).rejects.toThrow("symbolic links");
  expect(existsSync(join(outside, "inventory"))).toBe(false);
});
it("refuses files that are not ignored", async () => {
  const source = checkout(),
    target = checkout();
  output(source);
  writeFileSync(join(target, ".gitignore"), "");
  await expect(transferTaskArtifacts(source, target)).rejects.toThrow();
  expect(existsSync(join(target, "temp"))).toBe(false);
});

it("refuses dependency outputs modified after delivery", async () => {
  const source = checkout(),
    target = checkout();
  const path = "temp/local/inventory/result.txt";
  const file = output(source, path);
  const hashes = { [path]: createHash("sha256").update(readFileSync(file)).digest("hex") };
  writeFileSync(file, "changed after delivery");
  await expect(transferTaskArtifacts(source, target, [path], hashes)).rejects.toThrow(
    "Delivered task artifact changed",
  );
  expect(existsSync(join(target, path))).toBe(false);
});

it("cancels an artifact transfer without modifying its destination", async () => {
  const source = checkout(),
    target = checkout();
  output(source);
  const controller = new AbortController();
  controller.abort();
  await expect(
    transferTaskArtifacts(source, target, undefined, undefined, controller.signal),
  ).rejects.toThrow();
  expect(existsSync(join(target, "temp/local/inventory/result.txt"))).toBe(false);
});

it("cancels an in-flight stream hash without buffering a whole artifact", async () => {
  const source = checkout();
  const path = output(source);
  writeFileSync(path, Buffer.alloc(16 * 1024 * 1024));
  const controller = new AbortController();
  const hashing = hashTaskArtifact(path, controller.signal);
  controller.abort();
  await expect(hashing).rejects.toMatchObject({ name: "AbortError" });
});
