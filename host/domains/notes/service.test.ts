import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsyncHostNotes } from "../../host-notes-async";
import { createHostNotesService } from "./service";

const resources: Array<{ root: string; notes: AsyncHostNotes }> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.notes.close();
    rmSync(resource.root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bycoda-notes-domain-")),
    path = join(root, "desktop.db");
  const db = new DatabaseSync(path);
  db.exec(
    `CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,content_updated_at INTEGER NOT NULL DEFAULT 0)`,
  );
  db.close();
  const notes = new AsyncHostNotes(() => [path]);
  resources.push({ root, notes });
  const context = { authorized: vi.fn(async () => true) };
  const ports = {
    notes,
    project: vi.fn(async () => ({ cwd: "/project" })),
    session: vi.fn(async (id: string) => ({ projectId: "project", session: { id } })),
  };
  return { notes, context, ports, service: createHostNotesService(ports) };
}
const input = {
  id: "note",
  title: "Fixture",
  body: "body",
  tags: ["work"],
  sourceCwd: "/project",
  sourceSessionId: "session",
};
it("delegates full storage CAS and preview scoped reads", async () => {
  const f = fixture();
  const saved = await f.service.upsert({ note: input, expectedUpdatedAt: 0 }, f.context);
  const updated = await f.service.upsert(
    { note: { ...input, body: "next" }, expectedUpdatedAt: saved.updatedAt },
    f.context,
  );
  await expect(
    f.service.upsert({ note: input, expectedUpdatedAt: saved.updatedAt }, f.context),
  ).rejects.toThrow();
  expect(await f.service.list({ projectId: "project" }, f.context)).toMatchObject({
    total: 1,
    notes: [{ body: "next", preview: true }],
  });
  expect(await f.service.get({ id: "note", projectId: "unrelated" }, f.context)).toEqual(updated); // Existing paired global get.
  expect(
    await f.service.delete({ id: "note", expectedUpdatedAt: updated.updatedAt }, f.context),
  ).toEqual({ deleted: true });
});
it("does not replace the RPC's missing CAS token with embedded note metadata", async () => {
  const f = fixture();
  for (const options of [{}, { legacy: true }])
    await expect(
      f.service.upsert({ note: { ...input, expectedUpdatedAt: 0 } }, f.context, options),
    ).rejects.toThrow(/deleted/);
  expect(await f.notes.get(input.id)).toBeNull();
});
it("preserves session/project and note/source-session boundaries", async () => {
  const f = fixture();
  await f.service.upsert({ note: input, expectedUpdatedAt: 0 }, f.context);
  await expect(
    f.service.list({ sessionId: "session", projectId: "other" }, f.context),
  ).rejects.toThrow("another project");
  await expect(f.service.get({ id: "note", sessionId: "other" }, f.context)).rejects.toThrow(
    "another session",
  );
  expect((await f.service.list({ sessionId: "other" }, f.context)).total).toBe(0);
  expect(f.ports.project).not.toHaveBeenCalled();
});
it("rejects a revoked queued worker write before the storage commit", async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const waiting = new Promise<void>((done) => {
    entered = done;
  });
  const blocker = f.notes.save({ ...input, id: "blocker" }, 0, undefined, async () => {
    entered();
    await gate;
    return true;
  });
  await waiting;
  const queued = f.service.upsert({ note: input, expectedUpdatedAt: 0 }, f.context);
  await vi.waitFor(() => expect(f.context.authorized).toHaveBeenCalled());
  f.context.authorized.mockResolvedValue(false);
  release();
  await blocker;
  await expect(queued).rejects.toThrow("revoked");
  expect(await f.notes.get("note")).toBeNull();
});
it("suppresses delayed disclosure and keeps strict WS versus legacy extension tolerance", async () => {
  const f = fixture();
  await f.service.upsert({ note: input, expectedUpdatedAt: 0 }, f.context);
  await expect(f.service.get({ id: "note", extension: true }, f.context)).rejects.toThrow();
  expect(
    await f.service.get({ id: "note", extension: true }, f.context, { legacy: true }),
  ).toMatchObject({ id: "note" });
  const get = f.notes.get.bind(f.notes);
  vi.spyOn(f.notes, "get").mockImplementation(async (...args) => {
    const value = await get(...args);
    f.context.authorized.mockResolvedValue(false);
    return value;
  });
  await expect(f.service.get({ id: "note" }, f.context)).rejects.toThrow("revoked");
});
