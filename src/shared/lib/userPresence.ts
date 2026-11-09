import { elapsedSince, monotonicNow } from "./time/timestamps";

/** Input this recent, in a focused window, means someone is at this computer. */
export const USER_PRESENCE_IDLE_MS = 2 * 60_000;

let lastInputAt: number | undefined;
let listening = false;

function noteInput(): void {
  lastInputAt = monotonicNow();
}

/**
 * Whether the owner is using this window now: it has focus and saw keyboard,
 * pointer or wheel input recently. The Host uses this to hold phone pushes
 * while the desktop app already reaches the owner.
 */
export function userPresent(now = monotonicNow()): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  if (!listening) {
    listening = true;
    for (const type of ["keydown", "pointerdown", "pointermove", "wheel"])
      window.addEventListener(type, noteInput, { capture: true, passive: true });
    // Focus itself is input: the owner just switched to this window.
    window.addEventListener("focus", noteInput);
    if (document.hasFocus()) noteInput();
  }
  return (
    document.hasFocus() &&
    lastInputAt !== undefined &&
    elapsedSince(lastInputAt, now) <= USER_PRESENCE_IDLE_MS
  );
}
