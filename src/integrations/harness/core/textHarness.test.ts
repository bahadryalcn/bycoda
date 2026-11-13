import type { HostRunHandle } from "./hostRun";
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
const routing = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../../../features/model-routing/public/helpers", async (original) => ({
  ...(await original<typeof import("../../../features/model-routing/public/helpers")>()),
  resolveHelperModel: routing.resolve,
}));
import {
  generateCommitMessage,
  generatePrContent,
} from "../../../features/source-control/model/gitTextGeneration";
import {
  setHarnessModels,
  resetHarnessModelOverlays,
} from "../../../features/sessions/model/models";

beforeEach(() => {
  vi.clearAllMocks();
  routing.resolve.mockResolvedValue(undefined);
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
      modelSettings: { effort: "high", serviceTier: "fast", autoCompactWindow: "default" },
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
  routing.resolve.mockResolvedValue(undefined);
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
      modelSettings: { reasoningEffort: "low", autoCompactWindow: "default" },
    }),
  );
});

it("passes a captured original naming job through selected text generation", async () => {
  const hostRun = Object.freeze({}) as HostRunHandle;
  const operation = {};
  const control = Object.freeze({}) as HostRunHandle;
  const context = { operation, hostRun, hostControlRun: control };
  vi.mocked(runHarnessTextPrompt).mockResolvedValue('{"subject":"Scoped Git text","body":""}');
  const work = generateCommitMessage(
    "/repo",
    "claude",
    undefined,
    { harness: "claude", model: "claude:sonnet-5" },
    context,
  );
  context.hostRun = Object.freeze({}) as HostRunHandle;
  await expect(work).resolves.toBe("Scoped Git text");
  const input = vi.mocked(runHarnessTextPrompt).mock.calls[0][0];
  expect(input.operationContext?.operation).toBe(operation);
  expect(input.operationContext?.hostRun).toBe(hostRun);
});

it("uses the Git role model and account for commit generation", async () => {
  routing.resolve.mockResolvedValue({
    harness: "codex",
    model: "codex:gpt-6.1",
    providerAccountId: "routing-account",
    modelSettings: {},
  });
  vi.mocked(runHarnessTextPrompt).mockResolvedValue('{"subject":"Use role","body":""}');
  await generateCommitMessage("/repo", "claude");
  expect(runHarnessTextPrompt).toHaveBeenCalledWith(
    expect.objectContaining({ harness: "codex", providerAccountId: "routing-account" }),
  );
});
