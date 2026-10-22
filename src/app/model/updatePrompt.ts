const STORAGE_KEY = "bycoda.updatePrompt.snooze.v1";
export const UPDATE_PROMPT_SNOOZE_MS = 24 * 60 * 60 * 1000;

// Keep dismissal effective in this window even when storage is unavailable.
let memoryUntil = 0;

export function snoozeUpdatePrompt(now = Date.now()): void {
  memoryUntil = now + UPDATE_PROMPT_SNOOZE_MS;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(memoryUntil));
  } catch {
    // Storage can be disabled; the in-memory fallback still prevents nagging.
  }
}

export function isUpdatePromptSnoozed(now = Date.now()): boolean {
  let until = memoryUntil;
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored)) until = Math.max(until, stored);
  } catch {
    // Use the in-memory fallback.
  }
  // Ignore corrupt timestamps and clock changes that would silence it indefinitely.
  return until > now && until <= now + UPDATE_PROMPT_SNOOZE_MS;
}
