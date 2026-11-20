import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { HostStore, summary } from "../store";
import { sessionNeedsInput } from "../../src/features/sessions/model/session";
import { sessionAttention, sessionSnoozed, sessionUnread } from "./session-attention";

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
const base = (): HostSession =>
  ({
    projectId: "p",
    revision: 1,
    status: "idle",
    updatedAt: 100,
    session: { id: "s", title: "Session", cwd: "/tmp", harness: "codex", model: "", blocks: [] },
  }) as unknown as HostSession;

it("starts legacy sessions read and ignores owner metadata and user messages", () => {
  const old = base();
  expect(sessionUnread(old)).toBe(false);
  const input = {
    ...old,
    revision: 2,
    session: {
      ...old.session,
      title: "Renamed",
      blocks: [{ id: "u", role: "user" as const, text: "Hi" }],
    },
  };
  expect(sessionAttention(input, old)).toMatchObject({ unread: false, lastViewedRevision: 1 });
});

it("tracks new/changed assistant output, finished turns and input requests", () => {
  const old = { ...base(), lastViewedRevision: 1 };
  const assistant = { id: "a", role: "assistant" as const, text: "Hello" };
  const input = { ...old, revision: 2, session: { ...old.session, blocks: [assistant] } };
  expect(sessionAttention(input, old)).toMatchObject({ unread: true, agentActivityRevision: 2 });
  expect(
    sessionAttention(
      {
        ...input,
        revision: 3,
        session: { ...input.session, blocks: [{ ...assistant, text: "Hello again" }] },
      },
      input,
    ).unread,
  ).toBe(true);
  expect(sessionAttention({ ...old, revision: 2 }, { ...old, status: "running" }).unread).toBe(
    true,
  );
  const question = {
    ...old,
    revision: 2,
    session: { ...old.session, pendingQuestion: { requestId: 1, questions: [] } },
  } as HostSession;
  expect(sessionAttention({ ...question, snoozedUntil: 999999 }, old)).toMatchObject({
    unread: true,
    snoozedUntil: null,
  });
  expect(
    sessionAttention({ ...question, revision: 3, snoozedUntil: 999999 }, question, true)
      .snoozedUntil,
  ).toBe(999999);
  expect(
    sessionAttention(
      {
        ...question,
        revision: 3,
        session: { ...question.session, pendingQuestion: { requestId: 2, questions: [] } },
      },
      { ...question, snoozedUntil: 999999 },
    ).snoozedUntil,
  ).toBeNull();
});

it("does not allow a stale desktop mirror to erase Host attention metadata", () => {
  const old = { ...base(), forceUnread: true, lastViewedRevision: 1, snoozedUntil: 9999 };
  expect(
    sessionAttention({ ...base(), revision: 2, forceUnread: false, lastViewedRevision: 2 }, old),
  ).toMatchObject({ unread: true, snoozedUntil: 9999, lastViewedRevision: 1 });
});

it("expires snooze at its exact absolute deadline", () => {
  expect(sessionSnoozed({ snoozedUntil: 200 }, 199)).toBe(true);
  expect(sessionSnoozed({ snoozedUntil: 200 }, 200)).toBe(false);
  expect(sessionSnoozed({}, 0)).toBe(false);
});

it("persists read/unread and snooze across restart, rejects stale revisions and wakes for input", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-attention-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "host.db");
  let store = new HostStore(path);
  cleanups.push(() => store.close());
  const project = await store.addProject(directory, "Test");
  await store.save({ ...base(), projectId: project.id }, { type: "test" });
  let row = await store.updateSession("s", { unread: true, expectedRevision: 1 });
  expect(row.unread).toBe(true);
  await expect(store.updateSession("s", { unread: false, expectedRevision: 1 })).rejects.toThrow(
    "changed",
  );
  const until = Date.now() + 3_600_000;
  row = await store.updateSession("s", { snoozedUntil: until, expectedRevision: row.revision });
  await store.close();
  store = new HostStore(path);
  expect((await store.summaries(project.id))[0]).toMatchObject({
    unread: true,
    snoozedUntil: until,
  });
  row = await store.updateSession("s", { unread: false, expectedRevision: row.revision });
  expect(row).toMatchObject({ unread: false, snoozedUntil: until });
  expect((await store.session("s")).lastViewedAt).toBeGreaterThan(0);
  const current = await store.session("s");
  await store.save(
    {
      ...current,
      revision: current.revision + 1,
      session: { ...current.session, pendingQuestion: { requestId: 1, questions: [] } },
    } as HostSession,
    { type: "test" },
  );
  expect((await store.summaries(project.id))[0]).toMatchObject({
    unread: true,
    snoozedUntil: null,
  });
  await expect(store.updateSession("s", { snoozedUntil: -1 })).rejects.toThrow("Invalid snooze");
  await expect(store.updateSession("s", { snoozedUntil: Number.NaN })).rejects.toThrow(
    "Invalid snooze",
  );
  await store.updateSession("s", { snoozedUntil: until });
  expect((await store.updateSession("s", { snoozedUntil: null })).snoozedUntil).toBeNull();
});

it("lazily migrates an old summary without activity or mass unread changes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-attention-migrate-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "host.db");
  let store = new HostStore(path);
  const project = await store.addProject(directory, "Test");
  const saved = await store.save({ ...base(), projectId: project.id }, { type: "test" });
  const legacy = summary(saved);
  delete legacy.unread;
  delete legacy.snoozedUntil;
  await store.db
    .prepare("UPDATE session_state SET summary=? WHERE id=?")
    .run(JSON.stringify(legacy), "s");
  await store.close();
  store = new HostStore(path);
  cleanups.push(() => store.close());
  expect((await store.summaries(project.id))[0]).toMatchObject({
    unread: false,
    snoozedUntil: null,
    revision: 1,
  });
});

it("migrates a legacy snapshot without attention fields and persists its first read marker", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-attention-legacy-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "host.db");
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, cwd TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), snapshot TEXT NOT NULL, summary TEXT);
    INSERT INTO projects VALUES ('p', '/tmp', 'Test');`);
  legacy
    .prepare("INSERT INTO sessions (id, project_id, snapshot) VALUES ('s', 'p', ?)")
    .run(JSON.stringify(base()));
  legacy.close();
  let store = new HostStore(path);
  expect((await store.summaries("p"))[0]).toMatchObject({ unread: false, snoozedUntil: null });
  await store.updateSession("s", { unread: true, expectedRevision: 1 });
  const read = await store.updateSession("s", { unread: false, expectedRevision: 2 });
  await store.close();
  store = new HostStore(path);
  cleanups.push(() => store.close());
  expect(await store.session("s")).toMatchObject({
    unread: false,
    lastViewedRevision: 2,
    revision: read.revision,
  });
});

it("evaluates only the known block delta instead of rescanning the transcript", () => {
  const history = Array.from({ length: 500 }, (_, index) => ({
    id: `a${index}`,
    role: "assistant" as const,
    text: `reply ${index}`,
  }));
  const old = { ...base(), lastViewedRevision: 1, session: { ...base().session, blocks: history } };
  const user = { id: "u", role: "user" as const, text: "next" };
  let reads = 0;
  const blocks = new Proxy([...history, user], {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const input = { ...old, revision: 2, session: { ...old.session, blocks } };
  // Warm the per-array pending-approval cache, which is not part of this scan.
  sessionNeedsInput(input.session);
  reads = 0;
  const positions = new Map(history.map((block, index) => [block.id, index]));
  expect(sessionAttention(input, old, false, new Map([[user.id, user]]), positions)).toMatchObject({
    unread: false,
    agentActivityRevision: 0,
  });
  expect(reads).toBe(0);
  const reply = { id: "a499", role: "assistant" as const, text: "reply 499 continued" };
  expect(
    sessionAttention(input, old, false, new Map([[reply.id, reply]]), positions),
  ).toMatchObject({ unread: true, agentActivityRevision: 2 });
});
