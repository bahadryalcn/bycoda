import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStateFile, writeFileAtomic, writeFileAtomicSync } from "./atomic-write";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "bycoda-atomic-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("replaces the target without leaving temp files behind", async () => {
    const file = join(root, "nested", "state.json");
    await writeFileAtomic(file, '{"v":1}');
    await writeFileAtomic(file, '{"v":2}');
    expect(await readFile(file, "utf8")).toBe('{"v":2}');
    expect(await readdir(join(root, "nested"))).toEqual(["state.json"]);
  });

  it("has a synchronous form with the same guarantees", async () => {
    const file = join(root, "owner.lock");
    writeFileAtomicSync(file, "first");
    writeFileAtomicSync(file, Buffer.from("second"));
    expect(await readFile(file, "utf8")).toBe("second");
    expect(await readdir(root)).toEqual(["owner.lock"]);
  });
});

describe("readStateFile", () => {
  it("parses a healthy file and reports a missing one", async () => {
    const file = join(root, "state.json");
    expect(await readStateFile(file, JSON.parse)).toEqual({ status: "missing", value: undefined });
    await writeFileAtomic(file, '{"ok":true}');
    expect(await readStateFile(file, JSON.parse)).toEqual({ status: "ok", value: { ok: true } });
  });

  it("quarantines an empty or corrupt file instead of throwing", async () => {
    const file = join(root, "state.json");
    await writeFile(file, "");
    const empty = await readStateFile(file, JSON.parse);
    expect(empty.status).toBe("corrupt");
    await writeFile(file, '{"truncated":');
    const corrupt = await readStateFile(file, JSON.parse);
    expect(corrupt.status).toBe("corrupt");
    const names = (await readdir(root)).sort();
    expect(names).toHaveLength(2);
    expect(names.every((name) => name.startsWith("state.json.corrupt-"))).toBe(true);
    // The caller continues with "absent", so the next start succeeds.
    expect(await readStateFile(file, JSON.parse)).toEqual({ status: "missing", value: undefined });
  });
});
