import { afterEach, expect, it } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { bindSessionWork } from "../work/session-adapter";
import { summary } from "../store";
import { backgroundOwnerForWork, launchSessionRun } from "./sessionRuns";
import {
  isListedConversation,
  sessionBackgroundOwner,
} from "../../src/shared/model/host-contracts/delegation";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it("maps every background work kind to its owner and leaves chat-like work unowned", () => {
  const source = (kind: string) => ({ kind, id: "x", occurrence: "o" }) as never;
  expect(backgroundOwnerForWork(source("task.worker"))).toEqual({
    kind: "task",
    id: "x",
    role: "worker",
  });
  expect(backgroundOwnerForWork(source("task.repair"))?.role).toBe("worker");
  expect(backgroundOwnerForWork(source("task.recovery"))?.role).toBe("worker");
  expect(backgroundOwnerForWork(source("task.reviewer"))).toEqual({
    kind: "task",
    id: "x",
    role: "reviewer",
  });
  expect(backgroundOwnerForWork(source("goal.planner"))?.role).toBe("planner");
  expect(backgroundOwnerForWork(source("goal.finalReview"))?.role).toBe("finalReview");
  expect(backgroundOwnerForWork(source("automation"))?.kind).toBe("automation");
  expect(backgroundOwnerForWork(source("steward"))?.kind).toBe("steward");
  expect(backgroundOwnerForWork(source("crew.coordinator"))?.role).toBe("coordinator");
  expect(backgroundOwnerForWork(source("crew.member"))?.role).toBe("member");
  for (const kind of [
    "assistant",
    "social.generation",
    "delegation.advisor",
    "delegation.subagent",
  ])
    expect(backgroundOwnerForWork(source(kind))).toBeUndefined();
  expect(backgroundOwnerForWork(undefined)).toBeUndefined();
});

it.each([
  ["task.worker", "worker"],
  ["task.reviewer", "reviewer"],
] as const)("stamps the session a %s run creates with its owner", async (kind, role) => {
  const { store, engine, project } = await setup();
  bindSessionWork(store, engine);
  const settings = { effort: "low" };
  const started = await launchSessionRun(store, engine, {
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    modelSettings: settings,
    runtimeMode: "supervised",
    title: "Background",
    prompt: "Read only.",
    workspaceMode: "current",
    work: { kind, id: "task-1", occurrence: "first" },
  });
  expect(started.sessionId).toBeTruthy();
  const stored = await store.session(started.sessionId!);
  expect(sessionBackgroundOwner(stored.session)).toEqual({ kind: "task", id: "task-1", role });
  expect(stored.session.modelSettings.effort).toBe("low");
  const listed = summary(stored);
  expect(listed.backgroundOwner).toEqual({ kind: "task", id: "task-1", role });
  expect(isListedConversation(listed)).toBe(false);
  expect(isListedConversation({ ...listed, pinned: true })).toBe(true);
  expect(isListedConversation(listed, true)).toBe(true);
  expect(settings).toEqual({ effort: "low" });
});

it("leaves an ordinary launch without an owner", async () => {
  const { store, engine, project } = await setup();
  const started = await launchSessionRun(store, engine, {
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Chat",
    prompt: "Hi",
    workspaceMode: "current",
  });
  const stored = await store.session(started.sessionId!);
  expect(sessionBackgroundOwner(stored.session)).toBeUndefined();
  expect(summary(stored).backgroundOwner).toBeUndefined();
});
