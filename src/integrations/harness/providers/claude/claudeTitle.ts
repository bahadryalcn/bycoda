import type { HarnessOperationContext } from "../../core/types";
import type { GeneratedSessionTitle } from "../../../../features/sessions/model/sessionTitle";
import { generateSessionTitle } from "../../core/titleGeneration";
import { runClaudeTextPrompt } from "./claudeText";

export async function generateClaudeSessionTitle(input: {
  sessionId: string;
  cwd: string;
  message: string;
  model?: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
  operationContext?: HarnessOperationContext;
}): Promise<GeneratedSessionTitle | null> {
  return generateSessionTitle(input, runClaudeTextPrompt);
}
