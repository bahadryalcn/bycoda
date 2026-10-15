import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HandoffHistoryStore } from "./handoff-history";
describe("host handoff history", () => {
  it("hashes ids into private storage and provides bounded pagination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-handoff-test-"));
    try {
      const store = new HandoffHistoryStore(directory);
      const archive = await store.save({
        sessionId: "../session",
        messages: [
          { id: "first", role: "user", text: "Original intent" },
          { id: "second", role: "assistant", text: "Prior response" },
        ],
      });
      expect(archive.path.startsWith(join(directory, "handoff-history"))).toBe(true);
      expect(await store.read("../session", 0, 1)).toEqual({
        messages: [{ id: "first", role: "user", text: "Original intent" }],
        nextCursor: 1,
      });
      expect((await store.read("../session", 1)).nextCursor).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
