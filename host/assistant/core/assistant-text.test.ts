import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("../../../src/integrations/harness/core/register", () => ({ registerBuiltinHarnesses: vi.fn() }));
vi.mock("../../../src/integrations/harness/core/registry", () => ({ runHarnessTextPrompt: vi.fn() }));
import { runHarnessTextPrompt } from "../../../src/integrations/harness/core/registry";
import { assistantText } from "./assistant-text";
import type { AssistantProfile } from "../../../src/shared/model/host-contracts/assistant";

const paths: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});
const profile = {
  execution: { harness: "codex", model: "codex:test", modelSettings: { effort: "low" } },
} as AssistantProfile;
function runner() {
  const path = mkdtempSync(join(tmpdir(), "bycoda-assistant-text-"));
  paths.push(path);
  return assistantText(path);
}
it("keeps isolated reasoning and accounts monotonic valid provider metrics", async () => {
  vi.mocked(runHarnessTextPrompt).mockImplementation(async (input) => {
    input.onEvent?.({ type: "turn.metrics", inputTokens: 100, outputTokens: 30 });
    input.onEvent?.({ type: "turn.metrics", inputTokens: 90, outputTokens: 10 });
    input.onEvent?.({ type: "turn.metrics", inputTokens: -100, outputTokens: 20 });
    return "Answer";
  });
  expect(await runner()(profile, "Prompt")).toEqual({ text: "Answer", tokens: 130 });
  expect(runHarnessTextPrompt).toHaveBeenCalledWith(
    expect.objectContaining({
      harness: "codex",
      model: "test",
      modelSettings: { effort: "low" },
      intent: "plan",
      ephemeral: true,
      timeoutMs: 90000,
    }),
  );
});
it("retains only a valid provider-reported context window for the next Chief admission", async () => {
  vi.mocked(runHarnessTextPrompt).mockImplementation(async (input) => {
    input.onEvent?.({ type: "context", used: 5000, window: 128000 });
    input.onEvent?.({ type: "context", used: 5500, window: 0 });
    return "Answer";
  });
  expect(await runner()(profile, "Prompt")).toEqual({ text: "Answer", contextWindow: 128000 });
});
it("does not manufacture usage when the provider reports no metrics", async () => {
  vi.mocked(runHarnessTextPrompt).mockResolvedValue("Answer");
  expect(await runner()(profile, "Prompt")).toEqual({ text: "Answer" });
});
it("carries utility allowances without turning a conversational request into a persistent thread", async () => {
  vi.mocked(runHarnessTextPrompt).mockResolvedValue("Answer");
  await runner()(profile, "Prompt", undefined, undefined, {
    maxOutputTokens: 125,
    maxOutputChars: 500,
  });
  expect(runHarnessTextPrompt).toHaveBeenCalledWith(
    expect.objectContaining({ ephemeral: true, maxOutputTokens: 125, maxOutputChars: 500 }),
  );
});
it("opts only the Chief into its durably captured provider thread", async () => {
  vi.mocked(runHarnessTextPrompt).mockResolvedValue("Answer");
  const onThreadId = vi.fn(async () => undefined);
  await runner()(profile, "Current canonical state", undefined, {
    threadId: "chief-thread",
    onThreadId,
  });
  expect(runHarnessTextPrompt).toHaveBeenCalledWith(
    expect.objectContaining({
      ephemeral: false,
      threadId: "chief-thread",
      onThreadId,
      intent: "plan",
    }),
  );
});
it("refuses late output after reasoning cancellation", async () => {
  const controller = new AbortController();
  vi.mocked(runHarnessTextPrompt).mockImplementation(async () => {
    controller.abort();
    return "Late answer";
  });
  await expect(runner()(profile, "Prompt", controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});
it("adds actual compaction and reasoning metrics without counting repeated snapshots twice", async () => {
  const receipt = vi.fn(async () => undefined);
  vi.mocked(runHarnessTextPrompt).mockImplementation(async (input) => {
    input.onEvent?.({ type: "turn.metrics", inputTokens: 100, outputTokens: 30 });
    input.onEvent?.({ type: "turn.metrics", inputTokens: 90, outputTokens: 20 });
    await input.onCompacted!({ threadId: "chief-thread" });
    input.onEvent?.({ type: "turn.metrics", inputTokens: 200, outputTokens: 40 });
    input.onEvent?.({ type: "turn.metrics", inputTokens: 100, outputTokens: 10 });
    return "Answer";
  });
  expect(
    await runner()(profile, "Canonical handoff", undefined, {
      threadId: "chief-thread",
      onThreadId: async () => undefined,
      compactBefore: true,
      onCompacted: receipt,
    }),
  ).toEqual({ text: "Answer", tokens: 370 });
  expect(receipt).toHaveBeenCalledWith({ threadId: "chief-thread" });
});
it("keeps total usage unknown when compaction metrics are missing", async () => {
  vi.mocked(runHarnessTextPrompt).mockImplementation(async (input) => {
    await input.onCompacted!({ threadId: "chief-thread" });
    input.onEvent?.({ type: "turn.metrics", inputTokens: 200, outputTokens: 40 });
    return "Answer";
  });
  expect(
    await runner()(profile, "Canonical handoff", undefined, {
      threadId: "chief-thread",
      onThreadId: async () => undefined,
      compactBefore: true,
      onCompacted: async () => undefined,
    }),
  ).toEqual({ text: "Answer" });
});
it("rejects reasoning output if the adapter skipped the requested compaction receipt", async () => {
  vi.mocked(runHarnessTextPrompt).mockResolvedValue("Answer");
  await expect(
    runner()(profile, "Canonical handoff", undefined, {
      threadId: "chief-thread",
      onThreadId: async () => undefined,
      compactBefore: true,
      onCompacted: async () => undefined,
    }),
  ).rejects.toThrow("confirm Chief compaction");
});
