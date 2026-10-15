import { useContext, useEffect, useRef } from "react";
import type { SocialCollection, SocialCollectionFilter, SocialSnapshot } from "../model/social";
import { hostSocialFilterMatches } from "../model/socialWorkspace";
import { SocialPanelActiveContext } from "./socialContext";

/** Match against the full host dataset, retaining local filtering for older hosts.
 * Debounce typing and cancel pending changes when a retained panel is hidden. */
export function useSocialWorkspaceFilter(
  snapshot: SocialSnapshot,
  collection: SocialCollection,
  filter: SocialCollectionFilter,
  onChange?: (collection: SocialCollection, filter: SocialCollectionFilter) => void,
): boolean {
  const active = useContext(SocialPanelActiveContext);
  const callback = useRef(onChange);
  callback.current = onChange;
  const key = JSON.stringify(filter);
  const matches = hostSocialFilterMatches(snapshot, collection, filter);
  const enabled = !!snapshot.pages && !!onChange && active;
  useEffect(() => {
    if (!enabled || matches) return;
    const next = JSON.parse(key) as SocialCollectionFilter;
    const timer = setTimeout(() => callback.current?.(collection, next), 200);
    return () => clearTimeout(timer);
  }, [enabled, matches, key, collection]);
  return matches;
}
