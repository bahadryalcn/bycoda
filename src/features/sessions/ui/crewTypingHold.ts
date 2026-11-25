import { useSyncExternalStore } from "react";

/** The scene resumes this long after the last edit in an editable field. */
export const TYPING_HOLD_MS = 700;

const listeners = new Set<() => void>();
let typing = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return (
    target instanceof HTMLInputElement &&
    !/^(?:checkbox|radio|button|submit|reset|range|file|color|image)$/.test(target.type)
  );
}

function set(next: boolean) {
  if (typing === next) return;
  typing = next;
  for (const listener of listeners) listener();
}

/** A `beforeinput` whose matching `input` has not arrived yet, so one edit counts once. */
let awaitingInput = false;

/**
 * `beforeinput` fires for every real edit (typing, paste, drop, IME, dictation, undo) and for
 * nothing else, so Ctrl+C, selection and caret keys never hold the scene. `input` backs it up
 * for engines that skip `beforeinput` on some editors.
 */
function onEdit(event: Event) {
  if (event.type === "input" && awaitingInput) {
    awaitingInput = false;
    return;
  }
  if (!editable(event.target)) return;
  awaitingInput = event.type === "beforeinput";
  // The first edit only opens the window; holding starts with a second edit inside it, so a lone
  // key after a pause (nothing to protect) never pays for the hold.
  if (timer !== undefined) {
    set(true);
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    timer = undefined;
    set(false);
  }, TYPING_HOLD_MS);
}

const EVENTS = ["beforeinput", "input"] as const;

function subscribe(listener: () => void) {
  if (listeners.size === 0)
    for (const name of EVENTS)
      document.addEventListener(name, onEdit, { capture: true, passive: true });
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    for (const name of EVENTS) document.removeEventListener(name, onEdit, { capture: true });
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    typing = false;
    awaitingInput = false;
  };
}

/**
 * True while the user edits an editable field and for a short moment after. Subscribers hear
 * only when that flips, never per key, so a keystroke costs the scene a state change at the
 * start and end of a burst and nothing in between.
 */
export function useTypingHold(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typing,
    () => false,
  );
}
