/**
 * Chats whose interrupted turn the launch check judged safe to continue on its
 * own. Held in memory for this process only, so the prompt goes out at most
 * once per launch and never for a chat opened later from history that merely
 * ends with the quit note.
 */
const due = new Set<string>();

/** Test harness isolation for tests that reuse the same conversation ids. */
export function resetAutoContinueForTests(): void {
  due.clear();
}

export function markAutoContinueDue(sessionId: string): void {
  due.add(sessionId);
}

export function isAutoContinueDue(sessionId: string): boolean {
  return due.has(sessionId);
}

/** True once per chat: the caller that gets true sends the prompt. */
export function claimAutoContinue(sessionId: string): boolean {
  return due.delete(sessionId);
}
