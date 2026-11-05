import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../store";
import { AssistantObservationJournal } from "./assistant-observation-journal";
import { installAssistantObservationProducers } from "./assistant-observation-producers";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
it("observes committed canonical mutations with database-owned revisions; rollback and recreate remain distinct", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-observation-producers-"));
  const store = new HostStore(join(dir, "host.db"));
  await store.ready;
  cleanup.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await store.db.exec(
    "CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE goals(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE social_records(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE social_jobs(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,value TEXT NOT NULL)",
  );
  const journal = new AssistantObservationJournal(store);
  const coverage = await installAssistantObservationProducers(store, journal);
  expect(coverage.installed).toEqual([
    "sessions",
    "tasks",
    "goals",
    "social_records",
    "social_jobs",
    "metadata",
  ]);
  expect(coverage.unavailable).toContain("native-session");
  const insert = () =>
    store.db
      .prepare("INSERT INTO tasks VALUES(?,?)")
      .run("task", JSON.stringify({ projectId: "project", text: "private task body" }));
  await expect(
    store.transaction(async () => {
      await insert();
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  await insert();
  await store.db.prepare("DELETE FROM tasks WHERE id=?").run("task");
  await insert();
  const page = await journal.read(
    "chief",
    { projectId: "project" },
    async () => true,
    async () => true,
    () => true,
  );
  expect(page.events.map((event) => event.sourceRevision)).toEqual(["db:1", "db:2", "db:3"]);
  expect(page.events.map((event) => event.change)).toEqual(["created", "deleted", "created"]);
  expect(JSON.stringify(page)).not.toContain("private task body");
});

it("emits a scoped removal and new identity when a task changes project", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-observation-scope-"));
  const store = new HostStore(join(dir, "host.db"));
  await store.ready;
  cleanup.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await store.db.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
  const journal = new AssistantObservationJournal(store);
  await installAssistantObservationProducers(store, journal);
  await store.db
    .prepare("INSERT INTO tasks VALUES(?,?)")
    .run("task", JSON.stringify({ projectId: "old" }));
  await store.db
    .prepare("UPDATE tasks SET value=? WHERE id=?")
    .run(JSON.stringify({ projectId: "new" }), "task");
  const old = await journal.read(
    "a",
    { projectId: "old" },
    async () => true,
    async () => true,
    () => true,
  );
  const next = await journal.read(
    "b",
    { projectId: "new" },
    async () => true,
    async () => true,
    () => true,
  );
  expect(old.events.map((item) => item.change)).toEqual(["created", "deleted"]);
  expect(next.events.map((item) => item.change)).toEqual(["updated"]);
  expect(new Set([...old.events, ...next.events].map((item) => item.sourceRevision)).size).toBe(3);
});

it("emits personal social and project-scoped crew metadata without content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-observation-social-"));
  const store = new HostStore(join(dir, "host.db"));
  await store.ready;
  cleanup.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await store.db.exec(
    "CREATE TABLE social_records(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id))",
  );
  const journal = new AssistantObservationJournal(store);
  await installAssistantObservationProducers(store, journal);
  await store.db
    .prepare("INSERT INTO social_records VALUES(?,?,?)")
    .run(
      "thread",
      "thread-a",
      JSON.stringify({ accountId: "account-a", events: [{ text: "private inbound" }] }),
    );
  await store.db.prepare("INSERT INTO metadata VALUES(?,?)").run(
    "crews.v2.state",
    JSON.stringify({
      definitions: [{ projectId: "project", name: "private crew name" }],
      runs: [],
    }),
  );
  const social = await journal.read(
    "chief",
    { accountId: "account-a" },
    async () => true,
    async () => true,
    () => true,
  );
  const crew = await journal.read(
    "chief",
    { projectId: "project" },
    async () => true,
    async () => true,
    () => true,
  );
  expect(social.events).toMatchObject([
    { source: "social", sourceId: "thread:thread-a", accountId: "account-a" },
  ]);
  expect(crew.events).toMatchObject([{ source: "crew", sourceId: "crews.v1" }]);
  expect(JSON.stringify([social, crew])).not.toContain("private inbound");
  expect(JSON.stringify([social, crew])).not.toContain("private crew name");
});

it("does not parse or interfere with unrelated non-JSON Host metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-observation-metadata-"));
  const store = new HostStore(join(dir, "host.db"));
  await store.ready;
  cleanup.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const journal = new AssistantObservationJournal(store);
  await installAssistantObservationProducers(store, journal);
  await expect(
    store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?)").run("unrelated", "not-json"),
  ).resolves.toBeTruthy();
});

it("invalidates the old identity when an observed record changes kind or id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-observation-identity-"));
  const store = new HostStore(join(dir, "host.db"));
  await store.ready;
  cleanup.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await store.db.exec(
    "CREATE TABLE social_records(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id))",
  );
  const journal = new AssistantObservationJournal(store);
  await installAssistantObservationProducers(store, journal);
  const value = JSON.stringify({ accountId: "account" });
  await store.db.prepare("INSERT INTO social_records VALUES(?,?,?)").run("thread", "one", value);
  await store.db.prepare("UPDATE social_records SET id=? WHERE id=?").run("two", "one");
  await store.db.prepare("UPDATE social_records SET kind=? WHERE id=?").run("other", "two");
  const page = await journal.read(
    "room",
    { accountId: "account" },
    async () => true,
    async () => true,
    () => true,
  );
  expect(page.events.map(({ sourceId, change }) => [sourceId, change])).toEqual([
    ["thread:one", "created"],
    ["thread:one", "deleted"],
    ["thread:two", "updated"],
    ["thread:two", "deleted"],
  ]);
});
it("journals global Crew invalidations under Host ownership only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-observation-global-crew-"));
  const store = new HostStore(join(dir, "host.db"));
  await store.ready;
  cleanup.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const journal = new AssistantObservationJournal(store);
  await installAssistantObservationProducers(store, journal);
  await store.db
    .prepare("INSERT INTO metadata VALUES(?,?)")
    .run(
      "crews.v2.state",
      JSON.stringify({ definitions: [{ id: "global", name: "secret name" }], agents: [] }),
    );
  await store.db.prepare("UPDATE metadata SET value=? WHERE key=?").run(
    JSON.stringify({
      definitions: [
        { id: "global", name: "secret name" },
        { id: "scoped", projectId: "project" },
      ],
      agents: [],
    }),
    "crews.v2.state",
  );
  await store.db
    .prepare("UPDATE metadata SET value=? WHERE key=?")
    .run(JSON.stringify({ definitions: [], agents: [] }), "crews.v2.state");
  const events = await journal.read(
    "room",
    { hostLibrary: true },
    async () => true,
    async () => true,
    () => true,
  );
  expect(events.events.map((e) => e.source)).toEqual(["crew", "crew"]);
  expect(
    events.events.every(
      (e) => e.hostLibrary && !e.nativeInstallationId && e.projectIds.length === 0,
    ),
  ).toBe(true);
  expect(JSON.stringify(events)).not.toContain("secret name");
  expect(
    (
      await journal.read(
        "room",
        { nativeInstallationId: "desktop" },
        async () => true,
        async () => true,
        () => true,
      )
    ).events,
  ).toEqual([]);
});
