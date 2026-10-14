import type { GeneratedSessionTitle } from "../../../../features/sessions/model/sessionTitle";
import { generateSessionTitle } from "../../core/titleGeneration";
import { runClaudeTextPrompt } from "./claudeText";

export async function generateClaudeSessionTitle(input: {
  sessionId: string;
  cwd: string;
  message: string;
  providerAccountId?: string;
}): Promise<GeneratedSessionTitle | null> {
  return generateSessionTitle(input, runClaudeTextPrompt);
}
