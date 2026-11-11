import { useSyncExternalStore } from "react";

/**
 * The title bar's slot for the active single chat's own actions (project quick actions,
 * background-work indicator, status). The title bar renders the slot; the chat pane
 * portals its actions into it, so a lone chat has one chrome row with tabs and
 * actions together instead of a second toolbar row. Without a slot (a test, or a
 * window with no title bar) the pane keeps rendering its actions inline.
 */
// An object field instead of a reassigned module `let`: the value is read through the store.
const slot: { element: HTMLElement | null } = { element: null };
const listeners = new Set<() => void>();

function setSlotElement(element: HTMLElement | null) {
  if (slot.element === element) return;
  slot.element = element;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The element chat actions render into, or null when no title bar is mounted. */
export function useTitleBarActionsSlot(): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => slot.element,
    () => null,
  );
}

/** Render once inside the title bar, between the tab strip and the window controls. */
export function TitleBarActionsSlot() {
  return (
    <div
      ref={setSlotElement}
      data-titlebar-actions
      className="flex min-w-0 shrink items-center gap-1 px-1 empty:hidden"
    />
  );
}
