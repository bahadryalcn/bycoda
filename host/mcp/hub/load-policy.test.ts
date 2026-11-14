import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLoadingPolicy, writeLoadingPolicy } from "./load-policy";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-mcp-policy-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const corrupt = (dir: string, text: string) => {
  mkdirSync(join(dir, "mcp-hub"), { recursive: true });
  writeFileSync(join(dir, "mcp-hub", "loading.json"), text);
};

describe("MCP loading policy", () => {
  it("defaults to on demand when missing", async () => {
    expect(await readLoadingPolicy(tempDir())).toEqual({
      version: 1,
      mode: "onDemand",
      direct: [],
    });
  });

  it("round-trips a written policy and dedupes direct names", async () => {
    const dir = tempDir();
    await writeLoadingPolicy(dir, { version: 1, mode: "always", direct: ["a", "a", "b"] });
    expect(await readLoadingPolicy(dir)).toEqual({
      version: 1,
      mode: "always",
      direct: ["a", "b"],
    });
  });

  it("rejects an invalid policy", async () => {
    await expect(
      writeLoadingPolicy(tempDir(), { version: 1, mode: "onDemand", direct: ["../x"] }),
    ).rejects.toThrow();
  });

  it("loads on demand with a corrupt flag and refuses writes until repaired", async () => {
    const dir = tempDir();
    corrupt(dir, "{nope");
    expect(await readLoadingPolicy(dir)).toMatchObject({ mode: "onDemand", corrupt: true });
    await expect(
      writeLoadingPolicy(dir, { version: 1, mode: "always", direct: [] }),
    ).rejects.toThrow(/corrupt/);
    expect(readFileSync(join(dir, "mcp-hub", "loading.json"), "utf8")).toBe("{nope");
    await writeLoadingPolicy(dir, { version: 1, mode: "always", direct: [] }, undefined, {
      repair: true,
    });
    expect(await readLoadingPolicy(dir)).toMatchObject({ mode: "always" });
  });

  it("treats a schema-invalid file as corrupt", async () => {
    const dir = tempDir();
    corrupt(dir, JSON.stringify({ version: 2, mode: "always", direct: [] }));
    expect((await readLoadingPolicy(dir)).corrupt).toBe(true);
  });
});
