import type { InfiniteData } from "@tanstack/react-query";
import type { InboxItem, InboxUnifiedResult } from "./inboxTypes";

export type InboxPages = InfiniteData<InboxUnifiedResult, string | undefined>;

/** The Host lists newest first: `at` descending, then thread id descending. */
function sortsBefore(a: InboxItem, b: InboxItem): boolean {
  return a.at > b.at || (a.at === b.at && a.threadId > b.threadId);
}

/**
 * Folds a freshly read newest page into the loaded pages. Rows of the new page replace their older
 * copies (updates, rows moved to the top); loaded rows newer than the new page's last row that it no
 * longer lists were deleted or no longer match the filter, so they go. Rows older than that boundary
 * stay where they are, and the later pages keep their rows and cursors. Deletions further down the
 * list are not seen until the list is refetched in full.
 *
 * When the new page does not reach back into the loaded rows (a whole page of newer rows arrived, or
 * the list now fits in one page) the rows between would be missing, so the list restarts from it.
 */
export function refreshInboxPages(data: InboxPages, fresh: InboxUnifiedResult): InboxPages {
  const first = data.pages[0];
  const boundary = fresh.next ? fresh.items[fresh.items.length - 1] : undefined;
  const newest = first?.items[0];
  const restart: InboxPages = { pages: [fresh], pageParams: [undefined] };
  if (!first || data.pages.length === 1 || !boundary || !newest) return restart;
  if (sortsBefore(boundary, newest)) return restart;
  const freshIds = new Set(fresh.items.map((item) => item.threadId));
  const stays = (item: InboxItem) => !freshIds.has(item.threadId) && sortsBefore(boundary, item);
  return {
    pageParams: data.pageParams,
    pages: data.pages.map((page, index) =>
      index === 0
        ? { ...fresh, items: [...fresh.items, ...page.items.filter(stays)], next: page.next }
        : { ...page, items: page.items.filter(stays) },
    ),
  };
}

/**
 * Every thread once. A cursor shift between page reads can list the same thread on two pages; the
 * first (newest-side) copy wins so React keys stay unique. Page structure and cursors are untouched.
 */
export function dedupeInboxPages(data: InboxPages): InboxPages {
  const seen = new Set<string>();
  let changed = false;
  const pages = data.pages.map((page) => {
    const items = page.items.filter((item) => {
      if (seen.has(item.threadId)) return false;
      seen.add(item.threadId);
      return true;
    });
    if (items.length === page.items.length) return page;
    changed = true;
    return { ...page, items };
  });
  return changed ? { ...data, pages } : data;
}
