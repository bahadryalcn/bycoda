import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readStateFile,
  readStateFileSync,
  writeFileAtomic,
  writeFileAtomicSync,
} from "./atomic-write";

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
    const file = join(root, "nested", "owner.lock");
    writeFileAtomicSync(file, "first");
    writeFileAtomicSync(file, Buffer.from("second"));
    expect(await readFile(file, "utf8")).toBe("second");
    expect(await readdir(join(root, "nested"))).toEqual(["owner.lock"]);
  });

  it("retains the target and removes temporary files after failed publication", async () => {
    const target = join(root, "occupied");
    await mkdir(target);
    await writeFile(join(target, "prior"), "retained");
    await expect(writeFileAtomic(target, "new")).rejects.toThrow();
    expect(() => writeFileAtomicSync(target, "new")).toThrow();
    expect(await readFile(join(target, "prior"), "utf8")).toBe("retained");
    expect(await readdir(root)).toEqual(["occupied"]);
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
    expect(names.filter((name) => name.startsWith("state.json.corrupt-"))).toHaveLength(2);
    // A later reader must not mistake corruption for absent security policy.
    expect((await readStateFile(file, JSON.parse)).status).toBe("corrupt");
    expect(await readdir(root)).toHaveLength(3);
  });

  it("retains corrupt bytes without an evidence copy when requested", async () => {
    const file = join(root, "policy.json");
    await writeFile(file, "broken");
    expect((await readStateFile(file, JSON.parse, { quarantine: false })).status).toBe("corrupt");
    expect(readStateFileSync(file, JSON.parse, { quarantine: false }).status).toBe("corrupt");
    expect(await readFile(file, "utf8")).toBe("broken");
    expect(await readdir(root)).toEqual(["policy.json"]);
  });

  it.each(["async", "sync"])(
    "preserves a valid concurrent replacement during %s quarantine",
    async (kind) => {
      const file = join(root, "state.json");
      await writeFile(file, "broken");
      const parse = () => {
        writeFileSync(file, '{"repaired":true}');
        throw new Error("The originally read bytes were corrupt");
      };
      const result =
        kind === "async" ? await readStateFile(file, parse) : readStateFileSync(file, parse);
      expect(result.status).toBe("corrupt");
      if (result.status !== "corrupt" || !result.quarantined) throw new Error("Missing evidence");
      expect(readFileSync(result.quarantined, "utf8")).toBe("broken");
      expect(await readFile(file, "utf8")).toBe('{"repaired":true}');
      expect((await readStateFile(file, JSON.parse)).status).toBe("ok");
    },
  );

  it("keeps invalid UTF-8 as exact recovery bytes", async () => {
    const file = join(root, "state.json");
    const bytes = Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]);
    await writeFile(file, bytes);
    const result = await readStateFile(file, JSON.parse);
    expect(result.status).toBe("corrupt");
    if (result.status !== "corrupt" || !result.quarantined) throw new Error("Missing evidence");
    expect(await readFile(result.quarantined)).toEqual(bytes);
    expect(await readFile(file)).toEqual(bytes);
  });
});
