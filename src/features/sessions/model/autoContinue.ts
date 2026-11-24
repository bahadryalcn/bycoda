/**
 * Chats whose interrupted turn the launch check judged safe to continue on its
 * own. Held in memory for this process only, so the prompt goes out at most
 * once per launch and never for a chat opened later from history that merely
 * ends with the quit note.
 */
const due = new Set<string>();
const claimed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

/** Test harness isolation for tests that reuse the same conversation ids. */
export function resetAutoContinueForTests(): void {
  due.clear();
  claimed.clear();
}

export function subscribeAutoContinue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes whenever a chat becomes due, including after the first render. */
export function autoContinueVersion(): number {
  return version;
}

export function markAutoContinueDue(sessionId: string): void {
  due.add(sessionId);
  version += 1;
  for (const listener of listeners) listener();
}

export function isAutoContinueDue(sessionId: string): boolean {
  return due.has(sessionId);
}

/** True once per chat: the caller that gets true sends the prompt. */
export function claimAutoContinue(sessionId: string): boolean {
  const won = due.delete(sessionId);
  if (won) claimed.add(sessionId);
  return won;
}

/** This launch already sent, or is sending, the chat's continuation. */
export function wasAutoContinueClaimed(sessionId: string): boolean {
  return claimed.has(sessionId);
}
