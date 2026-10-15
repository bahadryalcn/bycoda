import type { GeneratedSessionTitle } from "../../../../features/sessions/model/sessionTitle";
import { generateSessionTitle } from "../../core/titleGeneration";
import { runCodexTextPrompt } from "./codexText";

/** Codex app-server turn that returns a sidebar title, or null on failure. */
export async function generateCodexSessionTitle(input: {
  sessionId: string;
  cwd: string;
  message: string;
  providerAccountId?: string;
}): Promise<GeneratedSessionTitle | null> {
  return generateSessionTitle(input, runCodexTextPrompt);
}
