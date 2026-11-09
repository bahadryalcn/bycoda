import { useEffect, useSyncExternalStore } from "react";
import { accountApi } from "../model/accountApi";
import { isSignedIn } from "../model/accountState";
import { announcementFeed, startAnnouncementPolling } from "../model/announcementFeed";
import { useAccountState } from "./useAccount";

/** Keeps the announcement feed fresh while signed in; guests fetch nothing and see nothing. Mount once. */
export function useAnnouncementPolling(): void {
  const state = useAccountState();
  const userId = isSignedIn(state) ? state.context.user.id : null;
  useEffect(() => {
    if (!userId) {
      announcementFeed.clear();
      return;
    }
    const stop = startAnnouncementPolling({
      feed: announcementFeed,
      fetchItems: () =>
        accountApi()
          .listAnnouncements()
          .then((list) => list.items),
    });
    return () => {
      stop();
      announcementFeed.clear();
    };
  }, [userId]);
}

export function useAnnouncementFeed() {
  return useSyncExternalStore(announcementFeed.subscribe, announcementFeed.getSnapshot);
}
