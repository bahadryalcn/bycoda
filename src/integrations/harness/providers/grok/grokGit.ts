import { createGitTextGeneration } from "../../core/gitGeneration";
import { runGrokTextPrompt } from "./grokText";

const generation = createGitTextGeneration({
  run: runGrokTextPrompt,
  timeoutMs: 60000,
  label: "Grok Build",
});

export const generateGrokCommitMessage = generation.generateCommitMessage;
export const generateGrokPrContent = generation.generatePrContent;
export const generateGrokBranchName = generation.generateBranchName;
