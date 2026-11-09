import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../store";
import { AssistantObservationJournal } from "./assistant-observation-journal";
import { installAssistantObservationProducers } from "./assistant-observation-producers";
import {
  AssistantObservationProjectPages,
  collectGoalObservationProjects,
} from "./assistant-observation-project-pages";

it("covers only delivered unchanged pages for the exact project source and consumer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "project-observation-pages-"));
  const store = new HostStore(join(dir, "host.db"));
  try {
    await store.ready;
    await store.db.prepare("INSERT INTO projects(id,cwd,name) VALUES(?,?,?)").run("p", "/p", "P");
    await store.db
      .prepare("INSERT INTO projects(id,cwd,name) VALUES(?,?,?)")
      .run("private-project", "/private", "Private");
    await store.db.exec(
      "CREATE TABLE tasks(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE goals(id TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    const journal = new AssistantObservationJournal(store);
    await installAssistantObservationProducers(store, journal);
    for (let i = 0; i < 9; i++)
      await store.db
        .prepare("INSERT INTO tasks VALUES(?,?)")
        .run(`task-${i}`, JSON.stringify({ projectId: "p", text: "private" }));
    await store.db
      .prepare("INSERT INTO tasks VALUES(?,?)")
      .run("other", JSON.stringify({ projectId: "other" }));
    const pages = new AssistantObservationProjectPages(store);
    const scope = {
      threadId: "room",
      projectId: "p",
      consumer: "room:task",
      source: "task" as const,
    };
    const first = await pages.page(scope, 0, undefined, () => true);
    const value = first.value as {
      snapshotId: string;
      offset: number;
      nextOffset: number;
      entries: unknown[];
    };
    expect(value.entries).toHaveLength(8);
    expect(JSON.stringify(first)).not.toContain("private");
    await expect(pages.page(scope, 8, value.snapshotId, () => true)).rejects.toThrow("in order");
    await expect(
      pages.delivered({ ...scope, consumer: "other" }, value.snapshotId, 0, 8, () => true),
    ).rejects.toThrow("expired");
    await pages.delivered(scope, value.snapshotId, 0, 8, () => true);
    const next = await pages.page(scope, 8, value.snapshotId, () => true);
    expect((next.value as { entries: unknown[] }).entries).toHaveLength(1);
    await pages.delivered(scope, value.snapshotId, 8, 9, () => true);
    expect((await pages.page(scope, 9, value.snapshotId, () => true)).complete).toBe(true);
    const changed = await pages.page(scope, 0, undefined, () => true);
    await store.db
      .prepare("UPDATE tasks SET value=? WHERE id=?")
      .run(JSON.stringify({ projectId: "p", text: "changed" }), "task-0");
    await expect(
      pages.delivered(
        scope,
        (changed.value as { snapshotId: string }).snapshotId,
        0,
        8,
        () => true,
      ),
    ).rejects.toThrow("changed");
    const emptyScope = { ...scope, projectId: "empty" };
    const empty = await pages.page(emptyScope, 0, undefined, () => true);
    const emptyId = (empty.value as { snapshotId: string }).snapshotId;
    expect((await pages.page(emptyScope, 0, emptyId, () => true)).complete).toBe(false);
    await pages.delivered(emptyScope, emptyId, 0, 0, () => true);
    expect((await pages.page(emptyScope, 0, emptyId, () => true)).complete).toBe(true);
    await store.db
      .prepare("INSERT INTO goals VALUES(?,?)")
      .run("goal", JSON.stringify({ projectIds: ["p", "private-project"], title: "private goal" }));
    const goalScope = { ...scope, source: "goal" as const, consumer: "room:goal" };
    const proofs = await collectGoalObservationProjects(store, "p");
    await expect(pages.page(goalScope, 0, undefined, () => true)).rejects.toThrow(
      "scope is unavailable",
    );
    await expect(
      pages.page(goalScope, 0, undefined, () => true, proofs.slice(0, 1)),
    ).rejects.toThrow("scope is unavailable");
    await expect(pages.page(goalScope, 0, undefined, () => false, proofs)).rejects.toThrow(
      "access changed",
    );
    const goal = await pages.page(goalScope, 0, undefined, () => true, proofs);
    expect((goal.value as { entries: unknown[] }).entries).toHaveLength(1);
    expect(JSON.stringify(goal)).not.toContain("private-project");
    expect(JSON.stringify(goal)).not.toContain("private goal");
    const goalId = (goal.value as { snapshotId: string }).snapshotId;
    await expect(pages.delivered(goalScope, goalId, 0, 1, () => false, proofs)).rejects.toThrow(
      "access changed",
    );
    await expect(
      pages.delivered(
        goalScope,
        goalId,
        0,
        1,
        () => true,
        proofs.map((proof) => ({ ...proof, cwd: "/wrong" })),
      ),
    ).rejects.toThrow("scope is unavailable");
    await store.db
      .prepare("UPDATE goals SET value=? WHERE id=?")
      .run(JSON.stringify({ projectIds: ["p"], title: "changed" }), "goal");
    await expect(pages.delivered(goalScope, goalId, 0, 1, () => true, proofs)).rejects.toThrow(
      "scope is unavailable",
    );
    const newProofs = await collectGoalObservationProjects(store, "p");
    await expect(pages.delivered(goalScope, goalId, 0, 1, () => true, newProofs)).rejects.toThrow(
      "changed",
    );
    await store.db.exec("DROP TRIGGER assistant_observe_tasks_insert");
    await expect(pages.page(scope, 0, undefined, () => true)).rejects.toThrow(
      "producer is unavailable",
    );
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
