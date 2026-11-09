import { useMemo, useState, useSyncExternalStore } from "react";
import { hasUnsentComposerDraft, subscribeComposerDraftPresence } from "../model/draftCache";

/**
 * Status inputs for list ranking that the list itself does not hold.
 * - `doneIds`: unseen finished sessions, plus the open session when it was unseen as it
 *   opened, so opening a Done row does not move it from under the pointer.
 * - `draftIds`: sessions whose composer holds unsent text or attachments, except the open
 *   one, so a row does not move while the user types. Re-renders only when the set changes.
 */
export function useSessionRankSignals(
  sessions: readonly { id: string }[],
  unseenFinishedIds: ReadonlySet<string>,
  activeId: string | null | undefined,
): { doneIds: ReadonlySet<string>; draftIds: ReadonlySet<string> } {
  const [opened, setOpened] = useState({ activeId, unseen: unseenFinishedIds, sticky: false });
  if (opened.activeId !== activeId || opened.unseen !== unseenFinishedIds) {
    const sticky =
      !!activeId && (opened.activeId === activeId ? opened.sticky : opened.unseen.has(activeId));
    setOpened({ activeId, unseen: unseenFinishedIds, sticky });
  }
  const stickyId = opened.sticky && activeId ? activeId : null;
  const doneIds = useMemo(
    () =>
      stickyId && !unseenFinishedIds.has(stickyId)
        ? new Set([...unseenFinishedIds, stickyId])
        : unseenFinishedIds,
    [stickyId, unseenFinishedIds],
  );
  const draftKey = useSyncExternalStore(
    subscribeComposerDraftPresence,
    () =>
      sessions
        .filter((session) => session.id !== activeId && hasUnsentComposerDraft(session.id))
        .map((session) => session.id)
        .join("\0"),
    () => "",
  );
  const draftIds = useMemo(() => new Set(draftKey ? draftKey.split("\0") : []), [draftKey]);
  return { doneIds, draftIds };
}
