import { useEffect, useEffectEvent, useLayoutEffect, useState, type RefObject } from "react";
import { LIST_PAGE_SIZE } from "../../shared/lib/listWindow";

type PagingState = {
  resetKey: string;
  sessions: number;
  folders: Record<string, number>;
};

const firstPage = (resetKey: string): PagingState => ({
  resetKey,
  sessions: LIST_PAGE_SIZE,
  folders: {},
});

/**
 * How many ungrouped rows and rows per folder are mounted. A new `resetKey`
 * (project, filters, search) goes back to the first page while rendering, and
 * the list scroller returns to the top once the new rows are laid out.
 */
export function useSessionListLimits(resetKey: string, scrollRef: RefObject<HTMLElement | null>) {
  const [paging, setPaging] = useState(() => firstPage(resetKey));
  let current = paging;
  if (paging.resetKey !== resetKey) {
    current = firstPage(resetKey);
    setPaging(current);
  }
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = 0;
  }, [resetKey, scrollRef]);

  const showMoreSessions = (shownCount: number) =>
    setPaging((previous) => ({
      ...previous,
      sessions: Math.max(previous.sessions, shownCount) + LIST_PAGE_SIZE,
    }));
  const showMoreInFolder = (key: string) =>
    setPaging((previous) => ({
      ...previous,
      folders: {
        ...previous.folders,
        [key]: (previous.folders[key] ?? LIST_PAGE_SIZE) + LIST_PAGE_SIZE,
      },
    }));
  return {
    sessionListLimit: current.sessions,
    folderListLimits: current.folders,
    showMoreSessions,
    showMoreInFolder,
  };
}

/**
 * Asks for the next page when the list's trailing sentinel scrolls near view.
 * The sidebar unmounts when hidden, so this follows the mounted sentinel rather
 * than retaining an observer on an old list whose row count stays the same.
 * Returns the ref callback to put on the sentinel.
 */
export function useSessionListSentinel({
  enabled,
  rootRef,
  shownCount,
  onLoadMore,
}: {
  enabled: boolean;
  rootRef: RefObject<HTMLElement | null>;
  shownCount: number;
  onLoadMore: (shownCount: number) => void;
}) {
  const [sentinel, setSentinel] = useState<HTMLLIElement | null>(null);
  const loadMore = useEffectEvent(onLoadMore);
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !sentinel || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore(shownCount);
      },
      { root, rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, shownCount, sentinel, rootRef]);
  return setSentinel;
}
