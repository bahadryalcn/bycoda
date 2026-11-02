import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import type { HostProvider } from "./providers";
import { AssistantTurnPolicyDeferredError, deferredAssistantTurn } from "./assistant-turn-policy";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-provider-hours-")),
    store = new HostStore(join(dir, "host.db"));
  await store.ready;
  const project = await store.addProject(dir, "Hours fixture"),
    send = vi.fn(async () => {});
  const provider = {
    send,
    stop: vi.fn(),
    cancel: vi.fn(),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  } as unknown as HostProvider;
  const engine = new HostEngine(store, { claude: provider });
  await engine.ready;
  const id = (
    await engine.command({
      type: "create",
      commandId: "create",
      projectId: project.id,
      workspaceMode: "current",
      harness: "claude",
      model: "claude:test",
      modelSettings: {},
      runtimeMode: "supervised",
    })
  ).sessionId;
  cleanups.push(async () => {
    await engine.close();
    await store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  return { engine, store, id, send };
}
it("checks the captured trusted worker author at provider admission and preserves the existing command guard", async () => {
  const f = await fixture(),
    stages: string[] = [];
  f.engine.beforeProviderTurn = async (input) => {
    expect(input.author).toMatchObject({ kind: "task", id: "canonical-task" });
    stages.push("policy");
    throw new Error("Outside active hours");
  };
  const send = () =>
    f.engine.withMessageAuthor(
      { kind: "task", id: "canonical-task", name: "Owner task", reason: "kickoff" },
      () => f.engine.command({ type: "send", commandId: "send", sessionId: f.id, text: "Work" }),
    );
  const receipt = await f.engine.withCommandAdmission(
    {
      check: async (stage) => {
        stages.push(stage.phase);
      },
    },
    send,
  );
  await f.engine
    .waitForRun(f.id, receipt.runId)
    .catch((error) => expect(String(error)).toContain("Outside active hours"));
  expect(stages).toContain("command");
  expect(stages).toContain("provider");
  expect(stages.at(-1)).toBe("policy");
  expect(f.send).not.toHaveBeenCalled();
});
it("rechecks after asynchronous preparation crosses the policy boundary", async () => {
  const f = await fixture();
  let allowed = true;
  const checks: boolean[] = [];
  f.engine.ownerInstructions = async () => {
    allowed = false;
    return "Existing owner rules";
  };
  f.engine.beforeProviderTurn = async () => {
    checks.push(allowed);
    if (!allowed) throw new Error("Outside active hours");
  };
  const receipt = await f.engine.withMessageAuthor(
    { kind: "task", id: "canonical-task", name: "Owner task", reason: "kickoff" },
    () => f.engine.command({ type: "send", commandId: "send", sessionId: f.id, text: "Work" }),
  );
  await f.engine.waitForRun(f.id, receipt.runId);
  expect(allowed).toBe(false);
  expect(checks).toEqual([true, false]);
  expect(f.send).not.toHaveBeenCalled();
});
it("persists an exact known-zero scheduling proof but rejects changed sources and another author's receipt", async () => {
  const f = await fixture();
  f.engine.beforeProviderTurn = async () => {
    throw new AssistantTurnPolicyDeferredError();
  };
  const receipt = await f.engine.withMessageAuthor(
    { kind: "task", id: "canonical-task", name: "Owner task", reason: "kickoff" },
    () =>
      f.engine.command({
        type: "send",
        commandId: "deferred",
        sessionId: f.id,
        text: "Original task",
      }),
  );
  await f.engine.waitForRun(f.id, receipt.runId);
  expect(f.send).not.toHaveBeenCalled();
  expect(await deferredAssistantTurn(f.store, f.id, receipt.runId, "canonical-task")).toBe(true);
  expect(await deferredAssistantTurn(f.store, f.id, receipt.runId, "different-task")).toBe(false);
  expect(await deferredAssistantTurn(f.store, f.id, "replacement-run", "canonical-task")).toBe(
    false,
  );
  const record = await f.store.session(f.id);
  await f.store.save(
    {
      ...record,
      revision: record.revision + 1,
      session: { ...record.session, modelSettings: { effort: "changed" } },
    },
    { type: "test.changed-execution-source" },
  );
  expect(await deferredAssistantTurn(f.store, f.id, receipt.runId, "canonical-task")).toBe(false);
});
it("never treats the same error text or an entered provider failure as proof of zero provider work", async () => {
  const f = await fixture();
  f.engine.beforeProviderTurn = async () => {
    throw new Error(new AssistantTurnPolicyDeferredError().message);
  };
  const receipt = await f.engine.withMessageAuthor(
    { kind: "task", id: "canonical-task", name: "Owner task", reason: "kickoff" },
    () =>
      f.engine.command({
        type: "send",
        commandId: "unproven",
        sessionId: f.id,
        text: "Original task",
      }),
  );
  await f.engine.waitForRun(f.id, receipt.runId);
  expect(await deferredAssistantTurn(f.store, f.id, receipt.runId, "canonical-task")).toBe(false);
  f.engine.beforeProviderTurn = undefined;
  f.send.mockRejectedValue(new AssistantTurnPolicyDeferredError());
  const entered = await f.engine.withMessageAuthor(
    { kind: "task", id: "canonical-task", name: "Owner task", reason: "kickoff" },
    () =>
      f.engine.command({
        type: "send",
        commandId: "entered",
        sessionId: f.id,
        text: "Explicit fresh attempt",
      }),
  );
  await f.engine.waitForRun(f.id, entered.runId);
  expect(f.send).toHaveBeenCalledOnce();
  expect(await deferredAssistantTurn(f.store, f.id, entered.runId, "canonical-task")).toBe(false);
});
