import { expect, it, vi } from "vitest";
import { journalAssistantSessionPorts } from "./assistant-session-action-journal";
import type { AssistantActionJournal } from "./assistant-action-journal";
import type { AssistantPorts } from "../service";
import type { HostStore } from "../../store";

it("retains autonomous request and source identities while preserving existing port results", async () => {
  const calls: unknown[] = [];
  const journal = {
    runAutonomous: async (input: unknown, effect: () => Promise<unknown>) => {
      calls.push(input);
      return effect();
    },
  } as unknown as AssistantActionJournal;
  const store = { session: async () => ({ projectId: "project" }) } as unknown as HostStore;
  const manage = vi.fn(async () => ({
    state: "queued" as const,
    taskId: "task",
    message: "Recovery queued",
  }));
  const answer = vi.fn(async () => undefined);
  const ports: AssistantPorts = { manageSession: manage, answerSession: answer };
  journalAssistantSessionPorts(store, journal, ports);
  const result = await ports.manageSession!({
    jobId: "job",
    sessionId: "session",
    requestId: "stable",
    text: "Private text",
    reason: "nudge",
  });
  expect(result).toMatchObject({ state: "queued" });
  expect(calls[0]).toMatchObject({
    operationId: "stable",
    action: "sessions.manage",
    target: "session",
    jobId: "job",
    projectIds: ["project"],
  });
  expect(manage).toHaveBeenCalledTimes(1);
});
