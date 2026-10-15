import { consumeBtwCommand } from "./btw";
import { isCompactCommand } from "./compact";
import { consumeDraftCommand } from "./draftCommand";
import { isMcpCommand } from "./mcpCommand";
import { isSessionFolderCommand } from "./sessionFolderCommand";

export const QUEUE_MESSAGE_COMMAND = "Composer: Queue Message";

/** Shift+Tab with no other modifier: the built-in default for queueing. */
export function isDefaultQueueChord(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): boolean {
  return event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/**
 * Whether the queue shortcut should act on this key press. It only takes the
 * key over while a turn is genuinely running and there is a message to queue;
 * in every other state the press is left alone, so Shift+Tab keeps moving focus
 * backwards. Commands handled inside the composer (/btw, /compact, /mcp,
 * /folder, /draft) are not messages, so they are never queued.
 */
export function queueShortcutApplies(input: {
  busy: boolean;
  /** Only background commands keep the turn open; the agent has yielded. */
  backgroundOnly: boolean;
  allowBusySubmit: boolean;
  disabled: boolean;
  popupOpen: boolean;
  draftMode: boolean;
  text: string;
  attachmentCount: number;
}): boolean {
  if (!input.busy || input.backgroundOnly || !input.allowBusySubmit) return false;
  if (input.disabled || input.popupOpen || input.draftMode) {
    return false;
  }
  if (!input.text.trim() && input.attachmentCount === 0) return false;
  const text = input.text;
  return !(
    consumeBtwCommand(text).matched ||
    consumeDraftCommand(text).matched ||
    isCompactCommand(text) ||
    isMcpCommand(text) ||
    isSessionFolderCommand(text)
  );
}
