import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browseHostDirectories, browseHostFolder, createHostDirectory } from "./browse";

describe("host directory browser", () => {
  it("bounds metadata listings and recognizes filesystem roots", async () => {
    const root = mkdtempSync(join(tmpdir(), "bycoda-folder-limit-"));
    try {
      for (let index = 0; index < 501; index++) writeFileSync(join(root, `file-${index}.txt`), "");
      expect((await browseHostFolder(root)).entries).toHaveLength(500);
      const { parse } = await import("node:path");
      expect((await browseHostFolder(parse(root).root)).parent).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("lists file metadata and resolves containing folders without exposing contents", async () => {
    const root = mkdtempSync(join(tmpdir(), "bycoda-folder-"));
    try {
      mkdirSync(join(root, "archive"));
      writeFileSync(join(root, "installer.exe"), "private binary contents");
      const result = await browseHostFolder(join(root, "installer.exe"), true);
      expect(result.path).toBe(root);
      expect(result.entries).toEqual([
        { name: "archive", path: join(root, "archive"), isDir: true, ignored: false },
        { name: "installer.exe", path: join(root, "installer.exe"), isDir: false, ignored: false },
      ]);
      expect(JSON.stringify(result)).not.toContain("private binary contents");
      await expect(browseHostFolder(join(root, "installer.exe"))).rejects.toThrow(
        "not a directory",
      );
      await expect(browseHostFolder("relative/path")).rejects.toThrow("Invalid");
      await expect(browseHostFolder("bad\0path")).rejects.toThrow("Invalid");
      await expect(browseHostFolder(root, "true")).rejects.toThrow("Invalid");
      await expect(browseHostFolder(join(root, "missing"), true)).rejects.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("yeni klasörü oluşturur, geçersiz adları ve mevcut klasörü reddeder", async () => {
    const root = mkdtempSync(join(tmpdir(), "bycoda-create-"));
    try {
      const result = await createHostDirectory(root, "Yeni klasör");
      expect(result.path).toBe(join(root, "Yeni klasör"));
      expect(result.home).toBeTruthy();
      expect(result.roots?.length).toBeGreaterThan(0);
      for (const name of ["..", "../outside", "a/b", "a\\b", "CON", "bad.", ""]) {
        await expect(createHostDirectory(root, name)).rejects.toThrow("Invalid folder name");
      }
      await expect(createHostDirectory(root, "Yeni klasör")).rejects.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("lists folders without exposing files and rejects relative paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "bycoda-browse-"));
    try {
      mkdirSync(join(root, "repo"));
      writeFileSync(join(root, "secret.txt"), "private data");
      const result = await browseHostDirectories(root);
      expect(result.path).toBe(root);
      expect(result.entries).toEqual([{ name: "repo", path: join(root, "repo") }]);
      expect(result.parent).not.toBeNull();
      await expect(browseHostDirectories("relative/path")).rejects.toThrow("absolute");
      await expect(browseHostDirectories("bad\0path")).rejects.toThrow("Invalid");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
