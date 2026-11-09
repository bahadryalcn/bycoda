import type { HarnessOperationContext } from "../../core/types";
import type { GeneratedSessionTitle } from "../../../../features/sessions/model/sessionTitle";
import { generateSessionTitle } from "../../core/titleGeneration";
import { runOpenCodeTextPrompt } from "./opencodeText";

export async function generateOpenCodeSessionTitle(input: {
  sessionId: string;
  cwd: string;
  message: string;
  model?: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
  operationContext?: HarnessOperationContext;
}): Promise<GeneratedSessionTitle | null> {
  return generateSessionTitle(input, runOpenCodeTextPrompt);
}
