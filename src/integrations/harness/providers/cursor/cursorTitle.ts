import type { GeneratedSessionTitle } from "../../../../features/sessions/model/sessionTitle";
import { generateSessionTitle } from "../../core/titleGeneration";
import { runCursorTextPrompt } from "./cursorText";

export function stopCursorTitleGeneration(_sessionId: string): Promise<void> {
  return Promise.resolve();
}

/** Cursor ACP turn that returns a sidebar title, or null on failure. */
export async function generateCursorSessionTitle(input: {
  sessionId: string;
  cwd: string;
  message: string;
}): Promise<GeneratedSessionTitle | null> {
  return generateSessionTitle(input, runCursorTextPrompt);
}
