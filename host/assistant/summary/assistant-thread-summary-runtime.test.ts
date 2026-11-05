import { expect, it, vi } from "vitest";
const utility = vi.hoisted(() => ({
  text: vi.fn(async (..._args: unknown[]) => ({ text: "Compact verified summary", tokens: 19 })),
}));
vi.mock("../core/assistant-text", () => ({
  assistantText: () => utility.text,
  chiefActions: () => [],
}));
vi.mock("../chief/assistant-chief-context", () => ({
  createAssistantChiefContext: () => ({ wake: async () => ({ actions: [] }) }),
}));
import { assistantExecutionPorts } from "../core/assistant-runtime";
import type { HostStore } from "../../store";
import type { HostGoals } from "../../goals/goals";
import type { HostTasks } from "../../tasks/tasks";
import type {
  AssistantProfile,
  AssistantThread,
  AssistantMessage,
} from "../../../src/shared/model/host-contracts/assistant";
it("uses the actual isolated text adapter and saved reply role with bounded complete summary inputs and no Goal/Task launch", async () => {
  const create = vi.fn(),
    store = {
      ready: Promise.resolve(),
      attachmentDir: "test/attachments",
      db: {
        scope: async (fn: () => unknown) => fn(),
        exec: async () => undefined,
        prepare: () => ({ get: async () => undefined }),
      },
    } as unknown as HostStore,
    goals = { create } as unknown as HostGoals,
    tasks = {} as HostTasks;
  const ports = assistantExecutionPorts(store, goals, tasks),
    worker = {
      harness: "codex",
      model: "worker",
      modelSettings: {},
      runtimeMode: "supervised",
      maxRunMinutes: 30,
    },
    profile = {
      execution: worker,
      replyExecution: {
        ...worker,
        harness: "claude",
        model: "saved-cheap-reply",
        modelSettings: { effort: "low" },
      },
    } as AssistantProfile,
    signal = new AbortController().signal;
  const result = await ports.summarize!({
    profile,
    thread: { summary: "Earlier retained decisions" } as AssistantThread,
    messages: [
      { role: "user", text: "First exact data" },
      { role: "assistant", text: "Second exact data" },
    ] as AssistantMessage[],
    instructions: "Owner rules remain restrictive",
    tokenCap: 8000,
    operationId: "exact-summary-operation",
    signal,
  });
  expect(result).toEqual({ text: "Compact verified summary", tokens: 19 });
  const [actual, prompt, actualSignal, _operation, limits] = utility.text.mock.calls[0] as [
    AssistantProfile,
    string,
    AbortSignal,
    unknown,
    { maxOutputTokens: number; maxOutputChars: number },
  ];
  expect(actual.execution).toMatchObject({
    harness: "claude",
    model: "saved-cheap-reply",
    modelSettings: { effort: "low" },
  });
  expect(actualSignal).toBe(signal);
  expect(prompt).toContain("Earlier retained decisions");
  expect(prompt).toContain("First exact data");
  expect(prompt).toContain("Second exact data");
  expect(limits).toEqual({ maxOutputTokens: 1500, maxOutputChars: 6000 });
  expect(create).not.toHaveBeenCalled();
  expect(profile.execution).toBe(worker);
});
