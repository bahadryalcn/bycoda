import { useSyncExternalStore } from "react";
import {
  hasUnsentComposerDraft,
  subscribeComposerDraftPresence,
} from "../model/draftCache";

const noSubscription = () => () => {};
const noDraft = () => false;

/**
 * Whether the session's composer holds typed text or attachments that were not sent.
 * Re-renders only when that answer flips, not on every keystroke.
 * Pass `enabled: false` for the session being typed in, where the composer already shows it.
 */
export function useUnsentComposerDraft(sessionId: string, enabled = true): boolean {
  return useSyncExternalStore(
    enabled ? subscribeComposerDraftPresence : noSubscription,
    () => enabled && hasUnsentComposerDraft(sessionId),
    noDraft,
  );
}
