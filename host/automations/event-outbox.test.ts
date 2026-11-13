import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { HostStore } from "../store";
import { AutomationEventOutbox, type AutomationTransitionEvent } from "./event-outbox";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "automation-events-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  await store.db.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE automations(id TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE automation_runs(id TEXT PRIMARY KEY,automation_id TEXT,value TEXT NOT NULL)`);
  const outbox = new AutomationEventOutbox(store);
  await outbox.prepare();
  await store.db
    .prepare("INSERT INTO tasks VALUES (?,?)")
    .run("task", JSON.stringify({ status: "running", projectId: "project" }));
  return { store, outbox };
}
it("emits immutable transition once and retains it across failed delivery and restart", async () => {
  const { store, outbox } = await fixture();
  await store.db
    .prepare("UPDATE tasks SET value=? WHERE id='task'")
    .run(JSON.stringify({ status: "done", projectId: "project" }));
  const attempts: AutomationTransitionEvent[] = [];
  await expect(
    outbox.drain(async (event) => {
      attempts.push(event);
      throw new Error("delivery unavailable");
    }),
  ).rejects.toThrow("delivery unavailable");
  const restarted = new AutomationEventOutbox(store);
  await restarted.drain(async (event) => {
    attempts.push(event);
  });
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
  expect(attempts[0]).toMatchObject({ kind: "task.finished", projectId: "project" });
  await store.db
    .prepare("UPDATE tasks SET value=? WHERE id='task'")
    .run(JSON.stringify({ status: "done", projectId: "project", title: "Changed" }));
  await restarted.drain(async (event) => {
    attempts.push(event);
  });
  expect(attempts).toHaveLength(2);
});
it("rolls event back with source transition", async () => {
  const { store, outbox } = await fixture();
  await expect(
    store.transaction(async () => {
      await store.db
        .prepare("UPDATE tasks SET value=? WHERE id='task'")
        .run(JSON.stringify({ status: "blocked", projectId: "project" }));
      throw new Error("abort");
    }),
  ).rejects.toThrow("abort");
  const events: AutomationTransitionEvent[] = [];
  await outbox.drain(async (event) => {
    events.push(event);
  });
  expect(events).toEqual([]);
});
it("emits failed run once and prevents recursive failure events", async () => {
  const { store, outbox } = await fixture();
  await store.db
    .prepare("INSERT INTO automations VALUES ('automation',?)")
    .run(JSON.stringify({ projectId: "project" }));
  for (const trigger of ["manual", "event"]) {
    await store.db
      .prepare("INSERT INTO automation_runs VALUES (?, 'automation', ?)")
      .run(trigger, JSON.stringify({ trigger, status: "running" }));
    await store.db
      .prepare("UPDATE automation_runs SET value=? WHERE id=?")
      .run(JSON.stringify({ trigger, status: "failed" }), trigger);
  }
  const events: AutomationTransitionEvent[] = [];
  await outbox.drain(async (event) => {
    events.push(event);
  });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ kind: "automation.failed", projectId: "project" });
});
