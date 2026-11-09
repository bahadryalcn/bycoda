import { useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import type { LinkedWorkItem } from "../../sessions/model/session";
import {
  inboxItemMatchesLinkedWorkItem,
  linkedWorkItemInboxKey,
} from "../../sessions/model/sessionWorkItem";
import { inboxItemKey, type InboxItem } from "../model/githubTasks";
import { useGithubWorkItem } from "./useGithubWorkItem";

/**
 * A session-card destination the Inbox has to reveal.
 *
 * A new `target` is applied while rendering: the owner is asked to show GitHub and
 * open the detail (`onReveal`), and the target key is pinned as the selection and
 * the search filter is shown empty. The pin is a layer over the user's retained
 * selection and search, which stay the user's own choices; `releaseTarget` drops
 * the pin once the user selects, switches source or edits the search.
 */
export function useLinkedTarget({
  target,
  onReveal,
}: {
  target: LinkedWorkItem | null;
  onReveal: () => void;
}) {
  const targetSelectionKey = target ? linkedWorkItemInboxKey(target) : null;
  const [revealed, setRevealed] = useState<LinkedWorkItem | null>(null);
  const [pinned, setPinned] = useState(false);
  if (target !== revealed) {
    setRevealed(target);
    if (target) {
      setPinned(true);
      onReveal();
    }
  }
  // Until the render-time apply above commits, the new target is already pinned.
  const pinActive = target != null && (pinned || target !== revealed);
  return {
    targetSelectionKey,
    /** Selection key the target forces while pinned; otherwise the user's own. */
    pinnedKey: pinActive ? targetSelectionKey : null,
    /** The search filter reads empty while the target is pinned. */
    searchPinned: pinActive,
    releaseTarget: () => setPinned(false),
  };
}

/**
 * The exact target item for when it is not in the loaded list. One shared work
 * item query (also used by the linked panel) looks it up and stays current when an
 * action patches the same item.
 */
export function useLinkedTargetItem({
  target,
  cwd,
  items,
}: {
  target: LinkedWorkItem | null;
  cwd: string;
  items: readonly InboxItem[];
}) {
  const inList = !target || items.some((item) => inboxItemMatchesLinkedWorkItem(item, target));
  const lookup = useGithubWorkItem(target, cwd, !inList);
  const targetItem =
    target && lookup.item && inboxItemMatchesLinkedWorkItem(lookup.item, target)
      ? lookup.item
      : null;
  const patchTargetItem = useStableCallback((next: InboxItem) => {
    if (targetItem && inboxItemKey(targetItem) === inboxItemKey(next)) lookup.setItem(next);
  });
  return {
    targetItem,
    patchTargetItem,
  };
}
