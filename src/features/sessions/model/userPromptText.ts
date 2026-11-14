/**
 * Text the app writes into user turns, and how a transcript shows it.
 * Dependency-free so the mobile app renders user turns the same way.
 */

/**
 * Sent to resume a turn cut off by a quit or crash. The work may have half
 * finished, so the agent must check before repeating anything that changes state.
 */
export const CONTINUE_PROMPT =
  "Continue where you left off. Your last turn was cut short, so a command or other action it started may have finished or may still be running. Before you repeat one that changes state, confirm it did not take effect and is not still running; if you cannot tell, say so instead of repeating it.";

/** Resumes a turn stopped by a usage limit; nothing was cut off mid-action. Also the pre-2026-11 restart prompt. */
export const RESUME_PROMPT = "Continue from where you left off.";

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

const ASSIGNMENT_BLOCK =
  /(?:\r?\n[ \t]*)*<bycoda_assignment\b[^>]*>[\s\S]*?<\/bycoda_assignment>/gi;

/** Task text a person should see: the assignment envelope stays in the send. */
export function visibleUserPrompt(text: string): string {
  return text.replace(ASSIGNMENT_BLOCK, "").trimEnd();
}

export const LEGACY_OPERATOR_COMMAND = /^\s*\/(?:mono|bycoda)(?=\s|$)\s*/i;

/** Old command messages remain enabled and render without their old prefix. */
export function operatorPromptText(text: string): string {
  const legacy = text.match(LEGACY_OPERATOR_COMMAND);
  if (!legacy) return text;
  return (
    text.slice(legacy[0].length).trim() || "Explain what you can do in bycoda with the app CLI."
  );
}
