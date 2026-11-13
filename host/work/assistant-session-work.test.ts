import { afterEach, expect, it } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { bindSessionWork } from "./session-adapter";
import {
  assistantSessionWorkTarget,
  enrollAssistantSteerUsage,
  runAssistantSessionWork,
} from "./assistant-session-work";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it("admits autonomous session send once and keeps its exact receipt in the canonical ledger", async () => {
  const f = await setup();
  const runtime = bindSessionWork(f.store, f.engine);
  const current = await f.store.session(f.id);
  const input = {
    source: { kind: "assistant" as const, id: "job:supervision", occurrence: "original-send" },
    projectId: f.project.id,
    target: assistantSessionWorkTarget(current, "grant-one"),
    commandId: "original-send",
    promptHash: "same-input",
    budgetScope: { taskId: "original-task", goalId: "original-goal" },
    admitted: async () => undefined,
    run: () =>
      f.engine.command({
        type: "send",
        commandId: "original-send",
        sessionId: f.id,
        text: "Continue",
      }),
  };
  const receipt = await runAssistantSessionWork(f.store, f.engine, input);
  await f.waitForTurnStart();
  expect(await runAssistantSessionWork(f.store, f.engine, input)).toEqual(receipt);
  expect(f.turns).toHaveLength(1);
  const record = (await runtime.work.list())[0]!;
  expect(record.receipt).toEqual({ sessionId: f.id, runId: receipt.runId });
  const row = await f.store.db.prepare("SELECT value FROM task_run_budget_ledger").get();
  expect(JSON.parse(String(row!.value))).toMatchObject({
    workId: record.id,
    sessionId: f.id,
    runId: receipt.runId,
    taskId: "original-task",
    goalId: "original-goal",
    rootWorkId: "task:original-task",
  });
  f.turns[0]!.finish();
});

it("enrolls steering into one existing physical run without reserving a second Work slot", async () => {
  const f = await setup();
  const runtime = bindSessionWork(f.store, f.engine);
  const receipt = await f.engine.command({
    type: "send",
    commandId: "owner-send",
    sessionId: f.id,
    text: "Owner turn",
  });
  await f.waitForTurnStart();
  const current = await f.store.session(f.id);
  await enrollAssistantSteerUsage(f.store, current, "supervision");
  await enrollAssistantSteerUsage(f.store, current, "other-supervision");
  expect(await runtime.work.list()).toEqual([]);
  const rows = await f.store.db.prepare("SELECT value FROM task_run_budget_ledger").all();
  expect(rows).toHaveLength(1);
  expect(JSON.parse(String(rows[0]!.value))).toMatchObject({
    sessionId: f.id,
    runId: receipt.runId,
  });
  f.turns[0]!.finish();
});
