import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

const measured = vi.hoisted(() => ({ reads: 0, bytes: 0 }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (path: string) => {
      const value = await actual.readFile(path);
      measured.reads++;
      measured.bytes += value.length;
      return value;
    },
  };
});
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fingerprintPaths } from "./fingerprint";

it("reads a bounded 16 MiB fixture once per fresh snapshot and detects changed bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fingerprint-io-"));
  try {
    const bytes = Buffer.alloc(16 * 1024 * 1024, 0x61);
    await writeFile(join(directory, "result"), bytes);
    measured.reads = 0;
    measured.bytes = 0;
    const first = createHash("sha256");
    expect(await fingerprintPaths(first, directory, ["result"], { entries: 0, bytes: 0 })).toBe(
      true,
    );
    expect(measured).toEqual({ reads: 1, bytes: bytes.length });
    const original = first.digest("hex");
    bytes[0] = 0x62;
    await writeFile(join(directory, "result"), bytes);
    const second = createHash("sha256");
    expect(await fingerprintPaths(second, directory, ["result"], { entries: 0, bytes: 0 })).toBe(
      true,
    );
    expect(second.digest("hex")).not.toBe(original);
    expect(measured).toEqual({ reads: 2, bytes: 2 * bytes.length });
    await writeFile(join(directory, "result"), Buffer.alloc(bytes.length + 1));
    expect(
      await fingerprintPaths(createHash("sha256"), directory, ["result"], { entries: 0, bytes: 0 }),
    ).toBe(false);
    expect(measured.reads).toBe(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
