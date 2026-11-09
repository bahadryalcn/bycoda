import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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

describe("incremental handoff storage", () => {
  it("reuses message blobs and materializes immutable full JSON only on demand", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-handoff-incremental-"));
    try {
      const store = new HandoffHistoryStore(directory);
      const first = { id: "one", role: "user" as const, text: "one" };
      const second = { id: "two", role: "assistant" as const, text: "two" };
      const saved = store.saveSync({ sessionId: "session", messages: [first] });
      const base = join(directory, "handoff-history");
      await expect(readdir(join(base, "exports"))).rejects.toMatchObject({ code: "ENOENT" });
      const firstPath = saved.path;
      expect(JSON.parse(await readFile(firstPath, "utf8"))).toEqual({
        sessionId: "session",
        messages: [first],
      });
      const updated = await store.save({ sessionId: "session", messages: [first, second] });
      expect(await readdir(join(base, "blobs"))).toHaveLength(3);
      expect(JSON.parse(await readFile(firstPath, "utf8"))).toEqual({
        sessionId: "session",
        messages: [first],
      });
      expect(JSON.parse(await readFile(updated.path, "utf8"))).toEqual({
        sessionId: "session",
        messages: [first, second],
      });
      expect(await store.read("session", 1, 1)).toEqual({ messages: [second] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reads legacy archives and fails on corrupt requested blobs without scanning later pages", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bycoda-handoff-legacy-"));
    try {
      const store = new HandoffHistoryStore(directory);
      const base = join(directory, "handoff-history");
      await mkdir(base, { recursive: true });
      const key = createHash("sha256").update("legacy").digest("hex");
      await writeFile(
        join(base, `${key}.json`),
        JSON.stringify({
          sessionId: "legacy",
          messages: [{ id: "old", role: "user", text: "legacy" }],
        }),
      );
      expect(await store.read("legacy")).toEqual({
        messages: [{ id: "old", role: "user", text: "legacy" }],
      });
      await store.save({
        sessionId: "legacy",
        messages: [
          { id: "one", role: "user", text: "one" },
          { id: "two", role: "assistant", text: "two" },
        ],
      });
      const manifest = JSON.parse(await readFile(join(base, `${key}.manifest.json`), "utf8"));
      await writeFile(join(base, "blobs", `${manifest.messages[1]}.json`), "damaged");
      expect((await store.read("legacy", 0, 1)).messages[0].id).toBe("one");
      await expect(store.read("legacy", 1, 1)).rejects.toThrow("Corrupt handoff history blob");
      await writeFile(join(base, `${key}.manifest.json`), "bad json");
      await expect(store.read("legacy")).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
