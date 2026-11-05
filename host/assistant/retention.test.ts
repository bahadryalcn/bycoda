import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../store";
import { HostAssistant } from "./service";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "assistant-retention-")),
    path = join(dir, "host.db");
  let now = Date.parse("2026-11-02T10:00:00Z"),
    store = new HostStore(path);
  const ports = {
    now: () => now,
    listProjects: async () => [{ id: "project-two", path: dir, name: "Two" }],
    roomProjectProofsValid: async (proofs: { projectId: string; cwd: string }[]) => {
      try { return (await Promise.all(proofs.map(async proof => (await store.project(proof.projectId)).cwd === proof.cwd))).every(Boolean); }
      catch { return false; }
    },
  };
  await store.ready;
  const project = await store.addProject(dir, "Two");
  await store.db.prepare("UPDATE projects SET id='project-two' WHERE id=?").run(project.id);
  let assistant = new HostAssistant(store, ports);
  await assistant.ready;
  closes.push(async () => {
    await assistant.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get service() {
      return assistant;
    },
    get store() {
      return store;
    },
    advance: (days: number) => {
      now += days * 86400000;
    },
    restart: async () => {
      await assistant.close();
      await store.close();
      store = new HostStore(path);
      await store.ready;
      assistant = new HostAssistant(store, ports);
      await assistant.ready;
    },
  };
}
async function append(
  f: Awaited<ReturnType<typeof fixture>>,
  threadId: string,
  key: string,
  text: string,
) {
  return (
    await f.service.request(
      { op: "threads.append", threadId, idempotencyKey: key, role: "user", via: "text", text },
      "owner",
    )
  ).message!;
}
it("clears an entire conversation beyond the visible page, preserving summary and unrelated threads", async () => {
  const f = await fixture(),
    thread = (await f.service.request({ op: "threads.open" }, "owner")).thread!;
  for (let index = 0; index < 105; index++)
    await append(f, thread.id, `m-${index}`, `message ${index}`);
  const other = (await f.service.request({ op: "threads.open", projectId: "project-two" }, "owner"))
    .thread!;
  await append(f, other.id, "other", "unrelated content");
  const current = (await f.service.request({ op: "snapshot" }, "owner")).snapshot!.threads.find(
    (value) => value.id === thread.id,
  )!;
  await f.service.request(
    {
      op: "threads.summary",
      threadId: thread.id,
      expectedVersion: current.version,
      summary: "A retained summary",
    },
    "assistant",
  );
  const updated = (await f.service.request({ op: "snapshot" }, "owner")).snapshot!.threads.find(
    (value) => value.id === thread.id,
  )!;
  await expect(
    f.service.request(
      { op: "threads.clear", threadId: thread.id, expectedVersion: updated.version - 1 },
      "owner",
    ),
  ).rejects.toThrow("changed");
  await f.service.request(
    { op: "threads.clear", threadId: thread.id, expectedVersion: updated.version },
    "owner",
  );
  expect(
    (await f.service.request({ op: "threads.messages", threadId: thread.id, limit: 100 }, "owner"))
      .messages,
  ).toEqual([]);
  expect(
    (await f.service.request({ op: "snapshot" }, "owner")).snapshot!.threads.find(
      (value) => value.id === thread.id,
    ),
  ).toMatchObject({ summary: "", summaryState: { status: "blocked" } });
  const retained = await f.store.db.prepare("SELECT value FROM assistant_threads WHERE id=?").get(thread.id);
  expect(JSON.parse(String(retained!.value)).summary).toBe("A retained summary");
  expect(
    (
      await f.service.request({ op: "threads.messages", threadId: other.id }, "owner")
    ).messages?.map((value) => value.text),
  ).toEqual(["unrelated content"]);
  expect(
    (await f.service.request({ op: "conversations.search", query: "message" }, "owner")).messages,
  ).toEqual([]);
  const deleted = await f.store.db
    .prepare("SELECT count(*) AS n FROM assistant_messages WHERE deleted_at IS NOT NULL")
    .get();
  expect(deleted?.n).toBe(105);
  await expect(
    f.service.request(
      { op: "threads.clear", threadId: thread.id, expectedVersion: updated.version },
      "assistant",
    ),
  ).rejects.toThrow("owner");
});
it("defaults to forever and applies explicit retention without discarding summaries or recent messages", async () => {
  const f = await fixture(),
    thread = (await f.service.request({ op: "threads.open" }, "owner")).thread!;
  const old = await append(f, thread.id, "old", "old message");
  f.advance(31);
  await append(f, thread.id, "recent", "recent message");
  await f.service.tick();
  expect(
    (await f.service.request({ op: "threads.messages", threadId: thread.id }, "owner")).messages,
  ).toHaveLength(2);
  await f.service.request({ op: "conversations.retention", days: 30 }, "owner");
  await f.restart();
  const snapshot = (await f.service.request({ op: "snapshot" }, "owner")).snapshot!;
  expect(snapshot.conversationRetentionDays).toBe(30);
  expect(
    (
      await f.service.request({ op: "threads.messages", threadId: thread.id }, "owner")
    ).messages?.map((message) => message.text),
  ).toEqual(["recent message"]);
  await f.service.request({ op: "trash.restore", id: `messages:${old.id}` }, "owner");
  await f.service.request({ op: "conversations.retention", days: 0 }, "owner");
  await f.service.tick();
  expect(
    (await f.service.request({ op: "threads.messages", threadId: thread.id }, "owner")).messages,
  ).toHaveLength(2);
});
it("purges expired message content but retains request tombstones so an old retry cannot resurrect it", async () => {
  const f = await fixture(),
    thread = (await f.service.request({ op: "threads.open" }, "owner")).thread!;
  const message = await append(f, thread.id, "once", "sensitive message");
  await f.service.request(
    { op: "messages.delete", id: message.id, expectedVersion: message.version },
    "owner",
  );
  f.advance(8);
  await f.service.tick();
  await f.restart();
  expect(
    await f.store.db.prepare("SELECT value FROM assistant_messages WHERE id=?").get(message.id),
  ).toBeUndefined();
  await expect(append(f, thread.id, "once", "sensitive message")).rejects.toThrow(
    "permanently deleted",
  );
  await expect(
    f.service.request({ op: "conversations.retention", days: 30 }, "chief"),
  ).rejects.toThrow("owner");
});
it("keeps the latest accepted speech language across restart and old transport retries", async () => {
  const f = await fixture(),
    now = Date.parse("2026-11-02T10:00:00Z");
  await f.service.request(
    { op: "voice.language.record", language: "tr-TR", requestId: "newer", observedAt: now },
    "owner",
  );
  await f.service.request(
    { op: "voice.language.record", language: "en-US", requestId: "older", observedAt: now - 1000 },
    "owner",
  );
  await f.restart();
  expect((await f.service.request({ op: "snapshot" }, "owner")).snapshot!.lastSpokenLanguage).toBe(
    "tr-TR",
  );
  await expect(
    f.service.request(
      { op: "voice.language.record", language: "en-US", requestId: "newer", observedAt: now },
      "owner",
    ),
  ).rejects.toThrow("identity changed");
  await expect(
    f.service.request(
      { op: "voice.language.record", language: "en-US", requestId: "not-owner", observedAt: now },
      "assistant",
    ),
  ).rejects.toThrow("owner");
  await f.service.request({ op: "briefing.daily", day: "2026-11-02" }, "owner");
  expect((await f.service.request({ op: "snapshot" }, "owner")).snapshot!.briefing!.text).toContain(
    "iş ilgini bekliyor",
  );
});
