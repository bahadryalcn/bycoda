import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostTasks } from "../../tasks/tasks";
import { HostGoals } from "../../goals/goals";
import { AsyncHostNotes } from "../../host-notes-async";
import { assistantExecutionPorts } from "./assistant-runtime";
import { HostAssistant } from "../service";
import { assistantDomain } from "../../domains/assistant/service";
import { AssistantResponseValidationSchema } from "../../../src/shared/model/host-contracts/assistant";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
it("creates an assistant Room note without an id using real AsyncHostNotes while retaining update, deletion and ownership gates", async () => {
  const folder = mkdtempSync(join(tmpdir(), "assistant-room-note-")),
    path = join(folder, "desktop.db"),
    db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,content_updated_at INTEGER NOT NULL DEFAULT 0)",
  );
  db.close();
  const store = new HostStore(join(folder, "host.db"));
  await store.ready;
  const engine = {
      command: vi.fn(async () => {
        throw new Error("Notes must not dispatch a model or session");
      }),
      updateSession: vi.fn(async () => {
        throw new Error("Notes must not edit a session");
      }),
    },
    tasks = new HostTasks(store, engine);
  await tasks.ready;
  const goals = new HostGoals(store, engine, tasks);
  await goals.ready;
  const notes = new AsyncHostNotes(() => [path]),
    ports = assistantExecutionPorts(store, goals, tasks, () => notes),
    service = new HostAssistant(store, ports);
  await service.ready;
  closes.push(async () => {
    await service.close();
    await notes.close();
    await tasks.close();
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const created = await ports.saveNote!({
    title: "New Room note",
    body: "The exact retained Markdown **body**",
  });
  expect(created.id).toBeTruthy();
  expect((await notes.get(created.id))?.body).toBe("The exact retained Markdown **body**");
  expect((await notes.get(created.id))?.sourceCwd).toBeUndefined();
  await expect(
    ports.saveNote!({ id: created.id, title: created.title, body: "No implicit overwrite" }),
  ).rejects.toThrow();
  const updated = await ports.saveNote!({
    id: created.id,
    title: created.title,
    body: "Explicit versioned update",
    expectedUpdatedAt: created.updatedAt,
  });
  expect(updated.body).toBe("Explicit versioned update");
  await notes.delete(updated.id, updated.updatedAt);
  await expect(
    ports.saveNote!({
      id: updated.id,
      title: updated.title,
      body: "No resurrection",
      expectedUpdatedAt: updated.updatedAt,
    }),
  ).rejects.toThrow("global assistant note");
  expect(await notes.get(updated.id)).toBeNull();
  const owner = await notes.save(
    { id: "owner-note", title: "Owner note", body: "Preserve owner content", tags: ["personal"] },
    0,
  );
  await expect(
    ports.saveNote!({
      id: owner.id,
      title: owner.title,
      body: "Not assistant-owned",
      expectedUpdatedAt: owner.updatedAt,
    }),
  ).rejects.toThrow("global assistant note");
  expect((await notes.get(owner.id))?.body).toBe("Preserve owner content");
  const rpc = assistantDomain(service, store),
    context = { principalId: "actual-owner-route", authorized: async () => true };
  const response = await rpc(
    { op: "notes.save", title: "Actual Room route", body: "Canonical DTO through the real worker" },
    context,
  );
  expect(AssistantResponseValidationSchema.safeParse(response).success).toBe(true);
  expect(response.note?.id).toBeTruthy();
  expect(response.note).not.toHaveProperty("slug");
  expect(response.note).not.toHaveProperty("slugPending");
  expect(response.note).not.toHaveProperty("contentUpdatedAt");
  const snapshot = await rpc({ op: "snapshot" }, context);
  expect(AssistantResponseValidationSchema.safeParse(snapshot).success).toBe(true);
  expect(snapshot.snapshot!.notes.find((note) => note.id === response.note!.id)).toEqual(
    response.note,
  );
  const explicit = await rpc(
    {
      op: "notes.save",
      id: "stable-owner-note",
      expectedUpdatedAt: 0,
      title: "Stable new note",
      body: "Created with its retained owner request ID",
    },
    context,
  );
  expect(explicit.note?.id).toBe("stable-owner-note");
  await expect(
    rpc(
      {
        op: "notes.save",
        id: "stable-owner-note",
        title: "Stable new note",
        body: "No missing-version overwrite",
      },
      context,
    ),
  ).rejects.toThrow();
  expect((await notes.get("stable-owner-note"))?.body).toBe(
    "Created with its retained owner request ID",
  );
  expect(
    (await rpc({ op: "snapshot" }, context)).snapshot!.notes.filter(
      (note) => note.id === "stable-owner-note",
    ),
  ).toHaveLength(1);
  expect((await rpc({ op: "notes.get", id: "stable-owner-note" }, context)).note).toEqual(
    explicit.note,
  );
  await notes.delete("stable-owner-note", explicit.note!.updatedAt);
  expect((await rpc({ op: "notes.get", id: "stable-owner-note" }, context)).note).toBeNull();
  // Native storage has no creation tombstone: a raw fresh create0 can recreate
  // a deleted ID. An UNKNOWN UI save must therefore park on a missing exact read,
  // never resend this payload merely because expectedUpdatedAt was zero.
  const recreated = await notes.save(
    {
      id: "stable-owner-note",
      title: "Explicit raw create after deletion",
      body: "Storage semantics fixture",
      tags: ["assistant"],
    },
    0,
  );
  expect(recreated.id).toBe("stable-owner-note");
  expect((await notes.get(recreated.id))?.body).toBe("Storage semantics fixture");
  const removed = await rpc(
    { op: "notes.delete", id: response.note!.id, expectedUpdatedAt: response.note!.updatedAt },
    context,
  );
  expect(removed.trashId).toMatch(/^notetrash:/);
  expect(removed.trashId).not.toBe(`notetrash:${response.note!.id}`);
  const deleted = (await rpc({ op: "snapshot" }, context)).snapshot!.trash.find(
    (item) => item.id === removed.trashId,
  );
  expect(deleted?.kind).toBe("notetrash");
  expect(deleted?.title).toBe(response.note!.title);
  expect(await notes.get(response.note!.id)).toBeNull();
  expect(AssistantResponseValidationSchema.safeParse(removed).success).toBe(true);
  expect(engine.command).not.toHaveBeenCalled();
  expect(engine.updateSession).not.toHaveBeenCalled();
});
