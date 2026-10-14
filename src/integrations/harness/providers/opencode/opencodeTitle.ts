import type { GeneratedSessionTitle } from "../../../../features/sessions/model/sessionTitle";
import { generateSessionTitle } from "../../core/titleGeneration";
import { runOpenCodeTextPrompt } from "./opencodeText";

export async function generateOpenCodeSessionTitle(input: {
  sessionId: string;
  cwd: string;
  message: string;
}): Promise<GeneratedSessionTitle | null> {
  return generateSessionTitle(input, runOpenCodeTextPrompt);
}
