import { createGitTextGeneration } from "../../core/gitGeneration";
import { defaultProviderAccountId } from "../../../../features/providers/model/providerAccounts";
import { runCodexTextPrompt } from "./codexText";

const generation = createGitTextGeneration({
  run: runCodexTextPrompt,
  timeoutMs: 90000,
  label: "Codex",
  commitAccount: () => defaultProviderAccountId("codex"),
});

export const generateCodexCommitMessage = generation.generateCommitMessage;
export const generateCodexPrContent = generation.generatePrContent;
export const generateCodexBranchName = generation.generateBranchName;
