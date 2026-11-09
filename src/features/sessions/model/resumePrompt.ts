import { CONTINUE_PROMPT, RESUME_PROMPT } from "./inFlight";

/**
 * A user turn the app sent to resume work rather than one the user typed.
 * Matched by text, so host chats and transcripts from older versions show
 * the same compact row without a stored flag.
 * - `restart`: resumed a turn cut off when the app quit or crashed.
 * - `resume`: resumed after a usage limit, or an older restart continue.
 */
export type ResumePromptKind = "restart" | "resume";

export function resumePromptKind(text: string): ResumePromptKind | undefined {
  const trimmed = text.trim();
  if (trimmed === CONTINUE_PROMPT) return "restart";
  if (trimmed === RESUME_PROMPT) return "resume";
  return undefined;
}
