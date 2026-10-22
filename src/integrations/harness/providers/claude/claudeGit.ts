import { createGitTextGeneration } from "../../core/gitGeneration";
import { defaultProviderAccountId } from "../../../../features/providers/model/providerAccounts";
import { runClaudeTextPrompt } from "./claudeText";

const generation = createGitTextGeneration({
  run: runClaudeTextPrompt,
  timeoutMs: 90000,
  label: "Claude Code",
  commitAccount: () => defaultProviderAccountId("claude"),
});

export const generateClaudeCommitMessage = generation.generateCommitMessage;
export const generateClaudePrContent = generation.generatePrContent;
export const generateClaudeBranchName = generation.generateBranchName;
