import { Buffer } from "node:buffer";
import { expect, it } from "vitest";
import type { NativeBufferPersistence } from "../ports/native-buffer-persistence";
import { createNativeBufferCompositePersistence } from "./native-buffer-composite-persistence";
import type { NativeBufferGitPersistence } from "./native-buffer-git-persistence";

/** Fake: names are listed in insertion order, cursor = index of the next name. */
function fake(files: Record<string, string>) {
  const names = Object.keys(files);
  const writes: string[] = [];
  const base = {
    read: async (key: string) => (key in files ? Buffer.from(files[key]) : null),
    directoryView: async () => 7,
    hasEntry: async (_d: string, name: string) => names.includes(name),
    entries: async (_d: string, after: string | null, limit: number) => {
      const start = after === null ? 0 : Number(after);
      const slice = names.slice(start, start + limit);
      const end = start + slice.length;
      return {
        entries: slice.map((name) => ({ name, isDirectory: false })),
        nextAfter: end < names.length ? String(end) : null,
      };
    },
    complete: async (batch: { writes: { key: string }[] }) => {
      writes.push(...batch.writes.map((w) => w.key));
    },
    readCertificate: async () => null,
    readClock: async () => null,
    initializeClock: async (s: unknown) => s,
    advanceClock: async (_e: unknown, n: unknown) => n,
  };
  return { persistence: base as unknown as NativeBufferPersistence, writes };
}

it("writes to the primary, reads fall back to legacy, listings come from the primary only", async () => {
  const primary = fake({ a: "pa", b: "pb" });
  const legacy = fake({ b: "lb", c: "lc", d: "ld" });
  const composite = createNativeBufferCompositePersistence({
    primary: primary.persistence as NativeBufferGitPersistence,
    legacy: legacy.persistence,
  });
  expect((await composite.read("b", 10))?.toString()).toBe("pb");
  expect((await composite.read("c", 10))?.toString()).toBe("lc");
  expect(await composite.read("zz", 10)).toBeNull();
  expect(await composite.hasEntry("", "d")).toBe(false);
  expect(await composite.directoryView()).toBe(7);
  await composite.complete({
    writes: [{ key: "n", bytes: Buffer.from("x"), immutable: false }],
    certificates: [],
    authorize: async () => undefined,
  });
  expect(primary.writes).toEqual(["n"]);
  expect(legacy.writes).toEqual([]);

  // The directories layer validates cursors as `directory-rowid:<N>`, so the listing and
  // its cursor must pass through unchanged from the primary; legacy names are not listed.
  const page = await composite.entries("", null, 10);
  expect(page.entries.map((e) => e.name)).toEqual(["a", "b"]);
  expect(page.nextAfter).toBeNull();
});
