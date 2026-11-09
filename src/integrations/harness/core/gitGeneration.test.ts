import type { HostRunHandle } from "./hostRun";
import { beforeEach, describe, expect, it, vi } from "vitest";
const fs = vi.hoisted(() => ({
  gitStagedContext: vi.fn(),
  gitRangeContext: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => fs);
import { createGitTextGeneration } from "./gitGeneration";

beforeEach(() => {
  vi.clearAllMocks();
  fs.gitStagedContext.mockResolvedValue({ branch: "main", summary: "file", patch: "patch" });
  fs.gitRangeContext.mockResolvedValue({
    base: "main",
    head: "feature",
    commitSummary: "First change\nSecond",
    diffSummary: "file",
    diffPatch: "patch",
  });
});
describe("shared Git text generation", () => {
  it("selects the commit account at call time and preserves the provider timeout", async () => {
    const run = vi.fn().mockResolvedValue('{"subject":"Fix file","body":""}');
    const account = vi.fn().mockReturnValue("current-account");
    const generation = createGitTextGeneration({
      run,
      timeoutMs: 90000,
      label: "Codex",
      commitAccount: account,
    });
    expect(await generation.generateCommitMessage("/p")).toContain("Fix file");
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ providerAccountId: "current-account", timeoutMs: 90000 }),
    );
    expect(account).toHaveBeenCalledTimes(1);
  });
  it("does not run Git or the model for a cancelled commit", async () => {
    const run = vi.fn();
    const generation = createGitTextGeneration({ run, timeoutMs: 60000, label: "Cursor" });
    const controller = new AbortController();
    controller.abort();
    await expect(generation.generateCommitMessage("/p", controller.signal)).rejects.toThrow();
    expect(fs.gitStagedContext).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it("falls back to the commit summary on a PR model error", async () => {
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const account = vi.fn();
    const generation = createGitTextGeneration({
      run,
      timeoutMs: 60000,
      label: "Grok Build",
      commitAccount: account,
    });
    expect(await generation.generatePrContent("/p")).toEqual({
      title: "First change",
      body: "First change\nSecond",
      base: "main",
      head: "feature",
    });
    expect(account).not.toHaveBeenCalled();
    debug.mockRestore();
  });
  it("preserves the provider-specific error text on an empty response", async () => {
    const generation = createGitTextGeneration({
      run: async () => "",
      timeoutMs: 60000,
      label: "Grok Build",
    });
    await expect(generation.generateCommitMessage("/p")).rejects.toThrow(
      "Grok Build returned no text.",
    );
  });
});

it("keeps the original Git helper scope while Git context is still pending", async () => {
  const source = Object.freeze({}) as HostRunHandle;
  const operation = {};
  const control = Object.freeze({}) as HostRunHandle;
  const context = { operation, hostRun: source, hostControlRun: control };
  let release!: (value: { branch: string; summary: string; patch: string }) => void;
  fs.gitStagedContext.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const run = vi.fn().mockResolvedValue('{"subject":"Keep source","body":""}');
  const generation = createGitTextGeneration({ run, timeoutMs: 60000, label: "helper" });
  const work = generation.generateCommitMessage("/p", undefined, context);
  context.hostRun = Object.freeze({}) as HostRunHandle;
  release({ branch: "main", summary: "file", patch: "patch" });
  await expect(work).resolves.toContain("Keep source");
  expect(run.mock.calls[0][0].operationContext.operation).toBe(operation);
  expect(run.mock.calls[0][0].operationContext.hostRun).toBe(source);
});
it("forwards the distinct branch job's exact operation and Host source", async () => {
  const hostRun = Object.freeze({}) as HostRunHandle;
  const operation = {};
  const run = vi.fn().mockResolvedValue("fix/original-source");
  const generation = createGitTextGeneration({ run, timeoutMs: 60000, label: "helper" });
  await expect(
    generation.generateBranchName("/p", "Fix original source", {
      operation,
      hostRun,
      hostControlRun: Object.freeze({}) as HostRunHandle,
    }),
  ).resolves.toBe("fix/original-source");
  expect(run.mock.calls[0][0].operationContext.operation).toBe(operation);
  expect(run.mock.calls[0][0].operationContext.hostRun).toBe(hostRun);
});
