import { createGitTextGeneration } from "../../core/gitGeneration";
import { runCursorTextPrompt, stopCursorTextPrompt } from "./cursorText";

export function stopCursorGitText(): Promise<void> {
  return stopCursorTextPrompt();
}

const generation = createGitTextGeneration({
  run: runCursorTextPrompt,
  timeoutMs: 60000,
  label: "Cursor",
});

export const generateCursorCommitMessage = generation.generateCommitMessage;
export const generateCursorPrContent = generation.generatePrContent;
export const generateCursorBranchName = generation.generateBranchName;
