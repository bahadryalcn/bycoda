import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: native.invoke }));

beforeEach(() => {
  vi.resetModules();
  native.invoke.mockReset();
});

it("refuses a compact receipt whose reread has matching version but different bytes", async () => {
  let reads = 0;
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "canonical_store_page_token") return "page";
    if (command === "canonical_store_transaction")
      return {
        applied: true,
        compacted: true,
        entries: [{ key: "entries:request", version: 2, value: null }],
      };
    if (command === "canonical_store_read") {
      reads++;
      if (reads === 1)
        return { entries: [{ key: "migration:complete", version: 1, value: true }], revision: 1 };
      if (reads === 2) return { entries: [], revision: 1 };
      return {
        entries: [
          { key: "entries:request", version: 2, value: { key: "request", raw: "different" } },
        ],
        revision: 2,
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  const { changeOutboxDatabase } = await import("./remoteOutboxDatabase");
  await expect(changeOutboxDatabase("request", null, "original")).rejects.toThrow(
    "The pending request changed.",
  );
});

it("accepts a compact receipt after exact canonical value reread", async () => {
  let reads = 0;
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "canonical_store_page_token") return "page";
    if (command === "canonical_store_transaction")
      return {
        applied: true,
        compacted: true,
        entries: [{ key: "entries:request", version: 2, value: null }],
      };
    if (command === "canonical_store_read") {
      reads++;
      if (reads === 1)
        return { entries: [{ key: "migration:complete", version: 1, value: true }], revision: 1 };
      if (reads === 2) return { entries: [], revision: 1 };
      return {
        entries: [
          { key: "entries:request", version: 2, value: { raw: "original", key: "request" } },
        ],
        revision: 2,
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  const { changeOutboxDatabase } = await import("./remoteOutboxDatabase");
  await expect(changeOutboxDatabase("request", null, "original")).resolves.toBeUndefined();
});
