import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { additionalDirsFor } from "../../src/integrations/harness/core/additionalDirs";
import { buildClaudeSpawnArgs } from "../../src/integrations/harness/providers/claude/claudeProtocol";
import {
  flushSessionAdditionalDirs,
  installHostAdditionalDirsResolver,
  setSessionAdditionalDirs,
  validateAdditionalDirs,
} from "./session-additional-dirs";

describe("Host session additional folders", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "bycoda-extra-dirs-"));
    mkdirSync(join(root, "project"));
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "file.txt"), "");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("accepts existing folders, drops duplicates and the working directory", async () => {
    const dirs = await validateAdditionalDirs(
      [join(root, "docs"), join(root, "docs"), join(root, "project")],
      join(root, "project"),
    );
    expect(dirs).toHaveLength(1);
    expect(dirs[0]!.toLowerCase()).toContain("docs");
  });

  it.each([
    ["relative paths", ["docs"]],
    ["missing folders", ["MISSING"]],
    ["files", ["FILE"]],
    ["filesystem roots", ["ROOT"]],
    ["non-strings", [1]],
    ["NUL bytes", ["a\0b"]],
  ])("rejects %s", async (_name, input) => {
    const mapped = input.map((entry) =>
      entry === "MISSING"
        ? join(root, "missing")
        : entry === "FILE"
          ? join(root, "file.txt")
          : entry === "ROOT"
            ? parse(root).root
            : entry,
    );
    await expect(validateAdditionalDirs(mapped, join(root, "project"))).rejects.toThrow();
  });

  it("rejects the home folder and non-arrays", async () => {
    await expect(
      validateAdditionalDirs([join(root, "docs")], join(root, "project"), join(root, "docs")),
    ).rejects.toThrow(/home folder/);
    await expect(validateAdditionalDirs("x", root)).rejects.toThrow();
    await expect(validateAdditionalDirs(Array(17).fill(root), root)).rejects.toThrow();
  });

  it("keeps each session's folders across a Host restart", async () => {
    const file = join(root, "state", "session-additional-dirs.json");
    installHostAdditionalDirsResolver(file);
    const [a, b, c] = ["a", "b", "c"].map((name) => join(root, name));
    for (const dir of [a, b, c]) mkdirSync(dir);
    setSessionAdditionalDirs("kept", [a, b]);
    setSessionAdditionalDirs("cleared", [c]);
    setSessionAdditionalDirs("cleared", []);
    await flushSessionAdditionalDirs();
    // A new process reads the same file.
    installHostAdditionalDirsResolver(file);
    expect(additionalDirsFor("kept")).toEqual([a, b]);
    expect(additionalDirsFor("cleared")).toEqual([]);
    writeFileSync(file, "not json");
    installHostAdditionalDirsResolver(file);
    expect(additionalDirsFor("kept")).toEqual([]);
  });

  it("feeds the provider adapters through the resolver", () => {
    installHostAdditionalDirsResolver();
    const extra = join(root, "docs");
    setSessionAdditionalDirs("host-s1", [extra]);
    expect(additionalDirsFor("host-s1")).toEqual([extra]);
    expect(
      buildClaudeSpawnArgs({
        additionalDirs: additionalDirsFor("host-s1"),
      } as never),
    ).toContain("--add-dir");
    setSessionAdditionalDirs("host-s1", []);
    expect(additionalDirsFor("host-s1")).toEqual([]);
  });

  it("drops folders that no longer exist, on load and while resolving", async () => {
    const file = join(root, "state", "session-additional-dirs.json");
    installHostAdditionalDirsResolver(file);
    const gone = join(root, "gone");
    const docs = join(root, "docs");
    mkdirSync(gone);
    setSessionAdditionalDirs("s", [docs, gone]);
    setSessionAdditionalDirs("only-gone", [gone]);
    await flushSessionAdditionalDirs();
    rmSync(gone, { recursive: true });
    expect(additionalDirsFor("s")).toEqual([docs]);
    installHostAdditionalDirsResolver(file);
    expect(additionalDirsFor("s")).toEqual([docs]);
    expect(additionalDirsFor("only-gone")).toEqual([]);
  });
});
