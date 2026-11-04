import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { HostTasks } from "../../tasks";
it("migrates the prior reason constraint atomically while retaining saved budget and owner holds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-hours-migration-")),
    store = new HostStore(join(dir, "host.db"));
  await store.ready;
  await store.db.exec(
    "CREATE TABLE task_goal_reason_holds(goal_id TEXT NOT NULL,reason TEXT NOT NULL CHECK(reason IN ('assistant-budget')),PRIMARY KEY(goal_id,reason)); INSERT INTO task_goal_reason_holds VALUES('retained-goal','assistant-budget'); CREATE TABLE task_goal_holds(goal_id TEXT PRIMARY KEY); INSERT INTO task_goal_holds VALUES('retained-goal');",
  );
  const engine = new HostEngine(store, {});
  await engine.ready;
  const tasks = new HostTasks(store, engine);
  try {
    await tasks.ready;
    await tasks.setGoalPauseReason("retained-goal", "assistant-hours", true);
    expect(
      await store.db.prepare("SELECT reason FROM task_goal_reason_holds ORDER BY reason").all(),
    ).toEqual([{ reason: "assistant-budget" }, { reason: "assistant-hours" }]);
    await tasks.setGoalPauseReason("retained-goal", "assistant-hours", false);
    expect(await store.db.prepare("SELECT reason FROM task_goal_reason_holds").all()).toEqual([
      { reason: "assistant-budget" },
    ]);
    expect(await store.db.prepare("SELECT goal_id FROM task_goal_holds").all()).toEqual([
      { goal_id: "retained-goal" },
    ]);
    expect(
      await store.db
        .prepare("SELECT name FROM sqlite_master WHERE name='task_goal_reason_holds_legacy_v1'")
        .get(),
    ).toBeUndefined();
  } finally {
    await tasks.close();
    await engine.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
