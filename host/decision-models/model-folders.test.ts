import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insideFile, scanModelFolder } from "./model-folders";

const HEADER = Buffer.concat([Buffer.from("GGUF"), Buffer.from([3, 0, 0, 0]), Buffer.alloc(16)]);
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "model-folders-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("bounded model folder scan", () => {
  it("preserves models already emitted when scanning is cancelled", async () => {
    writeFileSync(join(root, "model.gguf"), HEADER);
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested", "other.gguf"), HEADER);
    const controller = new AbortController();
    const found: string[] = [];
    const result = await scanModelFolder(root, controller.signal, (path) => {
      found.push(path);
      controller.abort();
    });
    expect(found).toEqual([realpathSync.native(join(root, "model.gguf"))]);
    expect(result.incomplete).toBe(true);
  });

  it("reports a depth-limited scan as incomplete", async () => {
    let path = root;
    for (let level = 0; level < 10; level++) {
      path = join(path, "nested");
      mkdirSync(path);
    }
    writeFileSync(join(path, "too-deep.gguf"), HEADER);
    const found: string[] = [];
    const result = await scanModelFolder(root, new AbortController().signal, (model) =>
      found.push(model),
    );
    expect(found).toEqual([]);
    expect(result.incomplete).toBe(true);
  });

  it("refuses a manifest path outside the selected folder", async () => {
    expect(await insideFile(root, tmpdir())).toBeUndefined();
  });

  it("does not follow directory junctions outside the selected folder", async () => {
    const outside = mkdtempSync(join(tmpdir(), "model-outside-"));
    try {
      writeFileSync(join(outside, "outside.gguf"), HEADER);
      symlinkSync(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
      const found: string[] = [];
      await scanModelFolder(root, new AbortController().signal, (path) => found.push(path));
      expect(found).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
