import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./registry", () => ({
  runHarnessTextPrompt: vi.fn(),
  generateHarnessCommitMessage: vi.fn(),
  generateHarnessPrContent: vi.fn(),
  warmupHarnessText: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitStagedContext: vi.fn(async () => ({
    branch: "feature",
    summary: "file.ts",
    patch: "+change",
  })),
  gitRangeContext: vi.fn(async () => ({
    base: "main",
    head: "feature",
    commitSummary: "Fix",
    diffSummary: "file.ts",
    diffPatch: "+change",
  })),
}));
vi.mock("../../../features/providers/model/providerAccounts", () => ({
  defaultProviderAccountId: (provider: string) => `${provider}-account`,
}));
import { runHarnessTextPrompt, generateHarnessCommitMessage } from "./registry";
import { generateCommitMessage, generatePrContent } from "./textHarness";
import {
  setHarnessModels,
  resetHarnessModelOverlays,
} from "../../../features/sessions/model/models";

beforeEach(() => {
  vi.clearAllMocks();
  resetHarnessModelOverlays();
});
it("passes the selected native model, account and advisor to isolated Git generation", async () => {
  vi.mocked(runHarnessTextPrompt).mockResolvedValue('{"subject":"Fix generation","body":""}');
  const signal = new AbortController().signal;
  await expect(
    generateCommitMessage("/repo", "codex", signal, {
      harness: "claude",
      model: "claude:sonnet-5",
      modelSettings: {
        advisor: "opus",
        subagentModel: "haiku",
        subagentPolicy: "force",
      },
    }),
  ).resolves.toBe("Fix generation");
  expect(runHarnessTextPrompt).toHaveBeenCalledWith(
    expect.objectContaining({
      harness: "claude",
      model: "claude-sonnet-5",
      modelSettings: expect.objectContaining({
        advisor: "opus",
        subagentModel: "haiku",
        subagentPolicy: "force",
      }),
      providerAccountId: "claude-account",
      intent: "plan",
      signal,
    }),
  );
  expect(generateHarnessCommitMessage).not.toHaveBeenCalled();
});
it("uses Codex advertised reasoning and service tier for PR generation", async () => {
  setHarnessModels("codex", [
    {
      id: "codex:test",
      harness: "codex",
      name: "Test",
      nativeId: "test",
      settings: [
        {
          id: "effort",
          label: "Reasoning",
          kind: "select",
          value: "medium",
          options: [
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ],
        },
        {
          id: "serviceTier",
          label: "Speed",
          kind: "select",
          value: "auto",
          options: [
            { value: "auto", label: "Auto" },
            { value: "fast", label: "Fast" },
          ],
        },
      ],
    },
  ]);
  vi.mocked(runHarnessTextPrompt).mockResolvedValue(
    '{"title":"Fix generation","body":"Description"}',
  );
  await expect(
    generatePrContent("/repo", "claude", {
      harness: "codex",
      model: "codex:test",
      modelSettings: { effort: "high", serviceTier: "fast" },
    }),
  ).resolves.toEqual({
    title: "Fix generation",
    body: "Description",
    base: "main",
    head: "feature",
  });
  expect(runHarnessTextPrompt).toHaveBeenCalledWith(
    expect.objectContaining({
      harness: "codex",
      model: "test",
      modelSettings: { effort: "high", serviceTier: "fast" },
    }),
  );
});
it("rejects malformed output and cancelled requests", async () => {
  const choice = {
    harness: "claude" as const,
    model: "claude:sonnet-5",
    modelSettings: {},
  };
  vi.mocked(runHarnessTextPrompt).mockResolvedValue("");
  await expect(generateCommitMessage("/repo", undefined, undefined, choice)).rejects.toThrow(
    "Could not generate",
  );
  vi.clearAllMocks();
  const controller = new AbortController();
  controller.abort();
  await expect(
    generateCommitMessage("/repo", undefined, controller.signal, choice),
  ).rejects.toThrow();
  expect(runHarnessTextPrompt).not.toHaveBeenCalled();
});

it("automatically uses a small Claude model with Advisor off", async () => {
  vi.mocked(runHarnessTextPrompt).mockResolvedValue('{"subject":"Fix generation","body":""}');
  await expect(generateCommitMessage("/repo", "claude")).resolves.toBe("Fix generation");
  expect(runHarnessTextPrompt).toHaveBeenCalledWith(
    expect.objectContaining({
      harness: "claude",
      model: "claude-haiku-4-5",
      modelSettings: expect.objectContaining({
        advisor: "off",
        subagentModel: "default",
      }),
    }),
  );
});

it("automatically prefers Codex Luna and low reasoning over the main flagship", async () => {
  setHarnessModels("codex", [
    { id: "codex:sol", harness: "codex", name: "GPT Sol", nativeId: "gpt-sol" },
    {
      id: "codex:luna",
      harness: "codex",
      name: "GPT Luna",
      nativeId: "gpt-luna",
      settings: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          kind: "select",
          value: "high",
          options: [
            { value: "high", label: "High" },
            { value: "low", label: "Low" },
          ],
        },
      ],
    },
  ]);
  vi.mocked(runHarnessTextPrompt).mockResolvedValue(
    '{"title":"Fix generation","body":"Description"}',
  );
  await generatePrContent("/repo", "codex");
  expect(runHarnessTextPrompt).toHaveBeenCalledWith(
    expect.objectContaining({
      harness: "codex",
      model: "gpt-luna",
      modelSettings: { reasoningEffort: "low" },
    }),
  );
});
