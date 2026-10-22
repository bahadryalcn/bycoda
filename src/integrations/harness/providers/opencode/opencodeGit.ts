import { createGitTextGeneration } from "../../core/gitGeneration";
import { runOpenCodeTextPrompt } from "./opencodeText";

const generation = createGitTextGeneration({
  run: runOpenCodeTextPrompt,
  timeoutMs: 90000,
  label: "OpenCode",
});

export const generateOpenCodeCommitMessage = generation.generateCommitMessage;
export const generateOpenCodePrContent = generation.generatePrContent;
export const generateOpenCodeBranchName = generation.generateBranchName;
