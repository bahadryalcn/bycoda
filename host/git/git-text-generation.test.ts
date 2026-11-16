import { beforeEach, expect, it, vi } from "vitest";
import type { runHarnessTextPrompt } from "../../src/integrations/harness/core/registry";
vi.mock("../../src/integrations/harness/core/register", () => ({
  registerBuiltinHarnesses: vi.fn(),
}));
import { generateGitText } from "./git-text-generation";

const choice = {
  harness: "codex" as const,
  model: "codex:gpt-6.1-sol",
  modelSettings: {},
  providerAccountId: "remote-account",
};
const staged = { branch: "feature", summary: "remote.ts", patch: "+remote change" };
const range = {
  base: "main",
  head: "feature",
  commitSummary: "Fix remote",
  diffSummary: "remote.ts",
  diffPatch: "+remote change",
};
const run = vi.fn(
  async (_input: Parameters<typeof runHarnessTextPrompt>[0]) =>
    '{"subject":"Fix remote","body":"Details"}',
);
const authorize = vi.fn(async () => {});
beforeEach(() => {
  vi.clearAllMocks();
  run.mockResolvedValue('{"subject":"Fix remote","body":"Details"}');
});

it("uses Host checkout, model, account and bounded isolated execution", async () => {
  const context = vi.fn(async () => staged);
  await expect(
    generateGitText(
      "/remote/repo",
      { projectId: "p", kind: "commit", choice },
      { context, authorize, run },
    ),
  ).resolves.toEqual({ message: "Fix remote\n\nDetails" });
  expect(context).toHaveBeenCalledWith("commit");
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      cwd: "/remote/repo",
      harness: "codex",
      model: "gpt-6.1-sol",
      providerAccountId: "remote-account",
      timeoutMs: 90_000,
      ephemeral: true,
    }),
  );
  expect(run.mock.calls[0][0].prompt).toContain("+remote change");
  expect(authorize).toHaveBeenCalledOnce();
});

it("rechecks authority after diff reads before entering the provider", async () => {
  authorize.mockRejectedValueOnce(new Error("Revoked"));
  await expect(
    generateGitText(
      "/remote/repo",
      { projectId: "p", kind: "commit", choice },
      { context: async () => staged, authorize, run },
    ),
  ).rejects.toThrow("Revoked");
  expect(run).not.toHaveBeenCalled();
});

it("preserves remote PR base and head", async () => {
  run.mockResolvedValueOnce('{"title":"Fix remote","body":"Details"}');
  await expect(
    generateGitText(
      "/remote/repo",
      { projectId: "p", kind: "pr", choice },
      { context: async () => range, authorize, run },
    ),
  ).resolves.toEqual({ title: "Fix remote", body: "Details", base: "main", head: "feature" });
});

it("reports malformed provider replies and provider errors without synthesizing success", async () => {
  run.mockResolvedValueOnce("");
  await expect(
    generateGitText(
      "/remote/repo",
      { projectId: "p", kind: "commit", choice },
      { context: async () => staged, authorize, run },
    ),
  ).rejects.toThrow("Could not generate a commit message");
  run.mockRejectedValueOnce(new Error("Provider unavailable"));
  await expect(
    generateGitText(
      "/remote/repo",
      { projectId: "p", kind: "pr", choice },
      { context: async () => range, authorize, run },
    ),
  ).rejects.toThrow("Provider unavailable");
});
