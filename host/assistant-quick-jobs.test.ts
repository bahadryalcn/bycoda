import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostTasks } from "./tasks";
import { HostGoals } from "./goals";
import { AsyncHostNotes } from "./host-notes-async";
import { assistantExecutionPorts } from "./assistant-runtime";
import { HostAssistant } from "./assistant/service";
import { assistantDomain } from "./assistant-domain";
import { assistantQuickNoteId } from "./assistant-quick-jobs";
import {
  AssistantRequestValidationSchema,
  AssistantResponseValidationSchema,
  type AssistantQuickNoteJob,
} from "../src/shared/model/host-contracts/assistant";
import { assistantJobProjectIds } from "../src/shared/model/assistantProjects";
import { normalizeAssistantQuickNoteAction } from "../src/shared/model/assistantQuick";
import { assertAssistantGoalProjects } from "./assistant-job-scope";

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
const context = { principalId: "quick-note-owner", authorized: async () => true };
const input = (key = "reviewed-note") => ({
  op: "jobs.create" as const,
  kind: "quick" as const,
  title: "Save the reviewed note",
  request: "Save this exact global note",
  idempotencyKey: key,
  quickAction: { kind: "note" as const, title: "Reviewed note", body: "Exact **Markdown**" },
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "assistant-quick-note-")),
    path = join(folder, "desktop.db"),
    db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE notes(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',tags_json TEXT NOT NULL DEFAULT '[]',source_session_id TEXT,source_cwd TEXT,slug_pending INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,content_updated_at INTEGER NOT NULL DEFAULT 0)",
  );
  db.close();
  let store = new HostStore(join(folder, "host.db"));
  await store.ready;
  const engine = {
    command: vi.fn(async () => {
      throw new Error("A quick note must not run a session");
    }),
    updateSession: vi.fn(async () => {
      throw new Error("A quick note must not edit a session");
    }),
  };
  let tasks = new HostTasks(store, engine);
  await tasks.ready;
  let goals = new HostGoals(store, engine, tasks);
  await goals.ready;
  const notes = new AsyncHostNotes(() => [path]),
    ports = assistantExecutionPorts(store, goals, tasks, () => notes);
  const save = vi.fn<AsyncHostNotes["save"]>((...args) => notes.save(...args));
  ports.quickNotes = () => ({ get: (id) => notes.get(id), save });
  ports.createGoal = vi.fn(async () => {
    throw new Error("A quick note must not create a Goal");
  });
  ports.chiefWake = vi.fn(async () => {
    throw new Error("A quick note must not wake Chief");
  });
  ports.reply = vi.fn(async () => {
    throw new Error("A quick note must not request an LLM reply");
  });
  let service = new HostAssistant(store, ports);
  await service.ready;
  const rpc = (raw: unknown) => assistantDomain(service, store)(raw, context);
  await rpc({
    op: "profile.update",
    expectedVersion: 0,
    patch: {
      name: "Quick note fixture",
      enabled: true,
      setupComplete: true,
      autonomy: "report",
      dailyTokenBudget: 100000,
      quietStart: 0,
      quietEnd: 0,
    },
  });
  closes.push(async () => {
    await service.close();
    await notes.close();
    await tasks.close();
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    notes,
    ports,
    save,
    engine,
    rpc,
    get service() {
      return service;
    },
    restart: async () => {
      await service.close();
      await tasks.close();
      await store.close();
      store = new HostStore(join(folder, "host.db"));
      await store.ready;
      tasks = new HostTasks(store, engine);
      await tasks.ready;
      goals = new HostGoals(store, engine, tasks);
      await goals.ready;
      const fresh = assistantExecutionPorts(store, goals, tasks, () => notes);
      Object.assign(ports, {
        listNotes: fresh.listNotes,
        getNote: fresh.getNote,
        saveNote: fresh.saveNote,
        listProjects: fresh.listProjects,
        jobDeletion: fresh.jobDeletion,
      });
      service = new HostAssistant(store, ports);
      await service.ready;
    },
    job: async () =>
      JSON.parse(
        (await store.db.prepare("SELECT value FROM assistant_jobs LIMIT 1").get())!.value,
      ) as AssistantQuickNoteJob,
  };
}

it("executes one owner-reviewed global note in Report mode through real Notes without Goal, Task, session or model effects", async () => {
  const f = await fixture(),
    raw = input();
  raw.quickAction.title = `  ${"A".repeat(210)}  `;
  raw.quickAction.body = "Exact **Markdown**\r\nsecond line\rthird line";
  const response = await f.rpc(raw),
    job = response.job!;
  expect(job.kind).toBe("quick");
  expect(job.status).toBe("done");
  expect(job.projectId).toBeNull();
  expect(assistantJobProjectIds(job)).toEqual([]);
  expect(job.taskIds).toEqual([]);
  expect(job.sessionIds).toEqual([]);
  expect(job.goalId).toBeUndefined();
  expect(job.tokens).toBe(0);
  expect(job.tokensComplete).toBe(true);
  expect(job.progress).toEqual({ done: 1, total: 1 });
  if (job.kind !== "quick") throw new Error("Wrong quick-job receipt");
  const note = await f.notes.get(job.quickResult!.noteId);
  expect(note?.title).toBe("A".repeat(200));
  expect(note?.body).toBe("Exact **Markdown**\nsecond line\nthird line");
  expect(note?.tags.every((tag) => tag.length <= 48)).toBe(true);
  expect(note?.sourceCwd).toBeUndefined();
  expect(note?.sourceSessionId).toBeUndefined();
  expect(AssistantResponseValidationSchema.safeParse(response).success).toBe(true);
  const snapshot = await f.rpc({ op: "snapshot" });
  expect(AssistantResponseValidationSchema.safeParse(snapshot).success).toBe(true);
  expect(snapshot.snapshot!.usage.total).toBe(0);
  expect(snapshot.snapshot!.capabilities.quickNotes).toBe(true);
  await f.service.tick();
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.ports.createGoal).not.toHaveBeenCalled();
  expect(f.ports.chiefWake).not.toHaveBeenCalled();
  expect(f.ports.reply).not.toHaveBeenCalled();
  expect(f.engine.command).not.toHaveBeenCalled();
  expect(
    AssistantRequestValidationSchema.safeParse({ ...raw, projectId: "fake-project" }).success,
  ).toBe(false);
  expect(AssistantRequestValidationSchema.safeParse({ ...raw, projectIds: [] }).success).toBe(
    false,
  );
  await expect(f.service.request(input("model-attempt"), "chief")).rejects.toThrow("owner");
  await expect(f.service.request(input("assistant-attempt"), "assistant")).rejects.toThrow("owner");
  expect(() =>
    assertAssistantGoalProjects(job, {
      id: `assistant-${job.id}`,
      projectIds: ["fake-project"],
      leadProjectId: "fake-project",
    }),
  ).toThrow();
});

it("retains exact idempotency and historical completion across restart and later independent note deletion", async () => {
  const f = await fixture(),
    created = (await f.rpc(input())).job!;
  if (created.kind !== "quick") throw new Error("Wrong kind");
  const note = await f.notes.get(created.quickResult!.noteId);
  expect((await f.rpc(input())).job!.id).toBe(created.id);
  await expect(
    f.rpc({
      ...input(),
      quickAction: { kind: "note", title: "Changed", body: "Different payload" },
    }),
  ).rejects.toThrow("original request");
  await f.notes.delete(note!.id, note!.updatedAt);
  await f.restart();
  await f.service.tick();
  const retried = (await f.rpc(input())).job!;
  expect(retried.status).toBe("done");
  expect(retried.kind === "quick" && retried.quickResult?.noteId).toBe(note!.id);
  expect(await f.notes.get(note!.id)).toBeNull();
  expect(f.save).toHaveBeenCalledTimes(1);
  await f.rpc({
    op: "jobs.control",
    id: retried.id,
    expectedVersion: retried.version,
    action: "delete",
  });
  expect(await f.notes.get(note!.id)).toBeNull();
  await expect(f.rpc(input())).rejects.toThrow("deleted");
});

it("reconciles a lost save acknowledgement from the exact owned note after restart without issuing another save", async () => {
  const f = await fixture();
  f.save.mockImplementationOnce(async (...args) => {
    await f.notes.save(...args);
    throw new Error("Lost acknowledgement after actual SQLite commit");
  });
  const waiting = (await f.rpc(input())).job!;
  expect(waiting.status).toBe("waiting");
  const id = assistantQuickNoteId(waiting.id);
  expect((await f.notes.get(id))?.body).toBe("Exact **Markdown**");
  await f.restart();
  await f.service.tick();
  const done = await f.job();
  expect(done.status).toBe("done");
  expect(done.quickResult?.noteId).toBe(id);
  expect(f.save).toHaveBeenCalledTimes(1);
});

it("parks an uncertain creation missing after owner deletion and never recreates its note", async () => {
  const f = await fixture();
  f.save.mockImplementationOnce(async (...args) => {
    const note = await f.notes.save(...args);
    await f.notes.delete(note.id, note.updatedAt);
    throw new Error("Acknowledgement lost and owner removed note");
  });
  const waiting = (await f.rpc(input())).job!;
  expect(waiting.status).toBe("waiting");
  await f.restart();
  await f.service.tick();
  await f.service.tick();
  expect((await f.job()).status).toBe("waiting");
  expect(await f.notes.get(assistantQuickNoteId(waiting.id))).toBeNull();
  expect(f.save).toHaveBeenCalledTimes(1);
});

it("does not overwrite an edited note while reconciling an uncertain receipt", async () => {
  const f = await fixture();
  f.save.mockImplementationOnce(async (...args) => {
    const note = await f.notes.save(...args);
    await f.notes.save({ ...note, body: "Owner's later edit" }, note.updatedAt);
    throw new Error("Lost acknowledgement");
  });
  const job = (await f.rpc(input())).job!;
  await f.restart();
  await f.service.tick();
  expect((await f.job()).status).toBe("waiting");
  expect((await f.notes.get(assistantQuickNoteId(job.id)))?.body).toBe("Owner's later edit");
  expect(f.save).toHaveBeenCalledTimes(1);
});

it("fences a queued actual Notes write when owner Stop arrives before final worker authorization", async () => {
  const f = await fixture(),
    entered = gate(),
    release = gate();
  f.save.mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return f.notes.save(...args);
  });
  const creating = f.rpc(input());
  await entered.promise;
  const running = await f.job(),
    stopping = f.rpc({
      op: "jobs.control",
      id: running.id,
      expectedVersion: running.version,
      action: "stop",
    });
  release.resolve();
  await creating;
  const stopped = (await stopping).job!;
  expect(stopped.status).toBe("cancelled");
  expect(await f.notes.get(assistantQuickNoteId(running.id))).toBeNull();
  await f.service.tick();
  expect(f.save).toHaveBeenCalledTimes(1);
});

it("retains the confirmed note receipt when Stop arrives after the admitted Notes commit", async () => {
  const f = await fixture(),
    committed = gate(),
    release = gate();
  f.save.mockImplementationOnce(async (...args) => {
    const note = await f.notes.save(...args);
    committed.resolve();
    await release.promise;
    return note;
  });
  const creating = f.rpc(input());
  await committed.promise;
  const running = await f.job(),
    stopping = f.rpc({
      op: "jobs.control",
      id: running.id,
      expectedVersion: running.version,
      action: "stop",
    });
  release.resolve();
  await creating;
  const stopped = (await stopping).job!;
  expect(stopped.status).toBe("cancelled");
  expect(stopped.kind === "quick" && stopped.quickResult?.noteId).toBe(
    assistantQuickNoteId(running.id),
  );
  expect((await f.notes.get(assistantQuickNoteId(running.id)))?.body).toBe("Exact **Markdown**");
  await f.service.tick();
  expect((await f.job()).status).toBe("cancelled");
  expect(f.save).toHaveBeenCalledTimes(1);
});

it("fences an old queued note creation immediately when owner disables the core", async () => {
  const f = await fixture(),
    entered = gate(),
    release = gate();
  f.save.mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return f.notes.save(...args);
  });
  const profile = (await f.rpc({ op: "snapshot" })).snapshot!.profile,
    creating = f.rpc(input());
  await entered.promise;
  const disabling = f.rpc({
    op: "profile.update",
    expectedVersion: profile.version,
    patch: { enabled: false },
  });
  release.resolve();
  const created = (await creating).job!;
  await disabling;
  expect(created.status).toBe("waiting");
  expect(await f.notes.get(assistantQuickNoteId(created.id))).toBeNull();
  const disabled = (await f.rpc({ op: "snapshot" })).snapshot!.profile;
  await f.rpc({
    op: "profile.update",
    expectedVersion: disabled.version,
    patch: { enabled: true },
  });
  await f.service.tick();
  expect(f.save).toHaveBeenCalledTimes(1);
  expect((await f.job()).status).toBe("waiting");
});

it("job deletion keeps its independently created real note", async () => {
  const f = await fixture(),
    created = (await f.rpc(input())).job!;
  if (created.kind !== "quick") throw new Error("Wrong kind");
  await f.rpc({
    op: "jobs.control",
    id: created.id,
    expectedVersion: created.version,
    action: "delete",
  });
  expect((await f.notes.get(created.quickResult!.noteId))?.body).toBe("Exact **Markdown**");
  expect((await f.rpc({ op: "snapshot" })).snapshot!.jobs).toEqual([]);
  expect(f.save).toHaveBeenCalledTimes(1);
});

it("normalizes astral note titles by Unicode codepoints exactly as real Notes storage", async () => {
  const action = normalizeAssistantQuickNoteAction({
    kind: "note",
    title: `  ${"😀".repeat(199)}AB  `,
    body: "line one\r\nline two",
  });
  expect(Array.from(action.title)).toHaveLength(200);
  expect(action.title).toBe(`${"😀".repeat(199)}A`);
  const f = await fixture(),
    note = await f.notes.save(
      {
        id: "unicode-note-proof",
        title: `  ${"😀".repeat(199)}AB  `,
        body: "line one\r\nline two",
        tags: ["assistant"],
      },
      0,
    );
  expect({ kind: "note", title: note.title, body: note.body }).toEqual(action);
  const response = await f.rpc({ ...input(), quickAction: action });
  expect(response.job!.status).toBe("done");
  expect(AssistantResponseValidationSchema.safeParse(response).success).toBe(true);
});
