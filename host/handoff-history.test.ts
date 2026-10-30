import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HandoffHistoryStore } from "./handoff-history";
describe("host handoff history", () => {
  it("retains recovered context and attachment ownership in the archive and returns extra context only on the first page", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-handoff-recovery-"));
    try {
      const store = new HandoffHistoryStore(directory);
      const first = {
        id: "original",
        role: "user" as const,
        text: "",
        attachments: [
          {
            id: "file",
            name: "contract.txt",
            mimeType: "text/plain",
            kind: "file" as const,
            size: 12,
            path: "/owner/contract.txt",
            hostEnvironmentId: "source-host",
            availability: "reference" as const,
          },
        ],
      };
      await store.save({
        sessionId: "recovered",
        retainedContext: "Original recovered state",
        messages: [first, { id: "answer", role: "assistant", text: "Original answer" }],
      });
      expect(await store.read("recovered", 0, 1)).toEqual({
        messages: [first],
        retainedContext: "Original recovered state",
        nextCursor: 1,
      });
      expect((await store.read("recovered", 1)).retainedContext).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
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
