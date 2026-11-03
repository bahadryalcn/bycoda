import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { withAssistantTaskMetadata } from "./assistant-task-metadata";
import type { HostTask } from "../src/features/tasks/model/hostTasks";

it("projects only canonical delivered follow-ups, separating unknown delivery and rejecting foreign jobs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-assistant-task-counts-")),
    store = new HostStore(join(directory, "host.db"));
  try {
    await store.ready;
    await store.db.exec(
      "CREATE TABLE assistant_jobs(id TEXT PRIMARY KEY,value TEXT NOT NULL,deleted_at INTEGER);CREATE TABLE assistant_session_receipts(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE goals(id TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    const task = {
      id: "task",
      goalId: "assistant-job",
      projectId: "project",
      sessionId: "session",
    } as HostTask;
    const job = {
      id: "job",
      goalId: "assistant-job",
      projectId: "project",
      projectIds: ["project"],
      sessionIds: ["session"],
      taskIds: ["task"],
    };
    const goal = {
      id: "assistant-job",
      leadProjectId: "project",
      projectIds: ["project"],
      taskIds: ["task"],
    };
    await store.db
      .prepare("INSERT INTO assistant_jobs(id,value) VALUES(?,?)")
      .run(job.id, JSON.stringify(job));
    await store.db
      .prepare("INSERT INTO goals(id,value) VALUES(?,?)")
      .run(goal.id, JSON.stringify(goal));
    for (const [key, action, delivery, state] of [
      ["one", "send", "delivered", "settled"],
      ["two", "send", "unknown", "unknown"],
      ["three", "send", "not_delivered", "settled"],
      ["four", "compact", "delivered", "settled"],
      ["five", "send", "delivered", "unknown"],
    ]) {
      await store.db
        .prepare("INSERT INTO assistant_session_receipts(id,value) VALUES(?,?)")
        .run(
          `job:session:${key}`,
          JSON.stringify({ operation: { sessionId: "session", action, delivery, state } }),
        );
    }
    await store.db
      .prepare("INSERT INTO assistant_session_receipts(id,value) VALUES(?,?)")
      .run(
        "foreign:session:six",
        JSON.stringify({
          operation: {
            sessionId: "session",
            action: "send",
            delivery: "delivered",
            state: "settled",
          },
        }),
      );
    expect((await withAssistantTaskMetadata(store, [task]))[0].assistantFollowups).toEqual({
      delivered: 1,
      unconfirmed: 1,
    });
    expect(task.assistantFollowups).toBeUndefined();
    expect(
      (await withAssistantTaskMetadata(store, [{ ...task, projectId: "private-foreign" }]))[0]
        .assistantFollowups,
    ).toBeUndefined();
    await store.db
      .prepare("UPDATE goals SET value=? WHERE id=?")
      .run(JSON.stringify({ ...goal, taskIds: [] }), goal.id);
    expect((await withAssistantTaskMetadata(store, [task]))[0].assistantFollowups).toBeUndefined();
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
it("keeps older Hosts and ordinary tasks free of fabricated zero counts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-assistant-task-legacy-")),
    store = new HostStore(join(directory, "host.db"));
  try {
    await store.ready;
    const tasks = [{ id: "task", goalId: "assistant-job", sessionId: "session" }] as HostTask[];
    expect(await withAssistantTaskMetadata(store, tasks)).toBe(tasks);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
