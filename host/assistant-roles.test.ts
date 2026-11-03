import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostAssistant } from "./assistant/service";
import { createAssistantChiefContext } from "./assistant-chief-context";
import { assistantRoleProfile } from "../src/shared/model/assistantRoles";
import type { AssistantTextRunner } from "./assistant-text";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
it("resumes the actual Chief thread across worker changes/restart and renews only for the changed chosen Chief provider", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-assistant-roles-")),
    store = new HostStore(join(directory, "host.db")),
    core = new HostAssistant(store);
  await core.ready;
  cleanups.push(async () => {
    await core.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = (await core.request({ op: "snapshot" }, "owner")).snapshot!.profile;
  const worker = {
    harness: "claude" as const,
    model: "worker-owner-model",
    modelSettings: { effort: "high" },
    runtimeMode: "full-access" as const,
    maxRunMinutes: 30,
  };
  const chief = {
    ...worker,
    harness: "codex" as const,
    model: "chief-owner-model",
    modelSettings: { effort: "low" },
  };
  const profile = { ...base, execution: worker, chiefExecution: chief };
  let count = 0;
  const text = vi.fn<AssistantTextRunner>(async (_profile, _prompt, _signal, context) => {
    await context!.onThreadId(context!.threadId ?? `utility-${++count}`);
    return { text: '{"actions":[]}', tokens: 10 };
  });
  const wake = (operationId: string, selected = profile) => ({
    profile: assistantRoleProfile(selected, "chief"),
    operationId,
    stateCard: "Canonical jobs with no actions",
    events: [],
    tokenCap: 1000000,
    signal: new AbortController().signal,
    contextPolicy: { soft: 10000, hard: 20000 },
  });
  const first = createAssistantChiefContext(store, text, { now: () => 1000 });
  await first.wake(wake("first"));
  const changedWorker = { ...profile, execution: { ...worker, model: "different-worker" } };
  await first.wake(wake("worker-changed", changedWorker));
  expect(text.mock.calls[1][0].execution).toEqual(chief);
  expect(text.mock.calls[1][3]?.threadId).toBe("utility-1");
  const restarted = createAssistantChiefContext(store, text, { now: () => 1001 });
  await restarted.wake(wake("restart", changedWorker));
  expect(text.mock.calls[2][3]?.threadId).toBe("utility-1");
  const changedChief = {
    ...changedWorker,
    chiefExecution: { ...chief, harness: "claude" as const, model: "new-chief" },
  };
  await restarted.wake(wake("chief-changed", changedChief as typeof profile));
  expect(text.mock.calls[3][0].execution).toMatchObject({ harness: "claude", model: "new-chief" });
  expect(text.mock.calls[3][3]?.threadId).toBeUndefined();
  expect(profile.execution).toEqual(worker);
  expect(profile.chiefExecution).toEqual(chief);
});
