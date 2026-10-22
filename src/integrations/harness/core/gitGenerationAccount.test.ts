import { expect, it, vi } from "vitest";
import { generateCodexCommitMessage } from "../providers/codex/codexGit";
import { generateClaudeCommitMessage } from "../providers/claude/claudeGit";
import { runCodexTextPrompt } from "../providers/codex/codexText";
import { runClaudeTextPrompt } from "../providers/claude/claudeText";
vi.mock("../../../features/providers/model/providerAccounts", () => ({
  defaultProviderAccountId: (provider: string) => `${provider}-selected-account`,
}));
vi.mock("../../../platform/tauri/fs", () => ({
  gitStagedContext: async () => ({ branch: "feature", summary: "changed.ts", patch: "+change" }),
}));
vi.mock("../providers/codex/codexText", () => ({
  runCodexTextPrompt: vi.fn(async () => '{"subject":"Fix generation","body":""}'),
}));
vi.mock("../providers/claude/claudeText", () => ({
  runClaudeTextPrompt: vi.fn(async () => '{"subject":"Fix generation","body":""}'),
}));
it.each([
  ["codex", generateCodexCommitMessage, runCodexTextPrompt],
  ["claude", generateClaudeCommitMessage, runClaudeTextPrompt],
] as const)(
  "uses the configured default %s account for Git text generation",
  async (provider, generate, run) => {
    await expect(generate("/repo")).resolves.toBe("Fix generation");
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ providerAccountId: `${provider}-selected-account`, cwd: "/repo" }),
    );
  },
);
