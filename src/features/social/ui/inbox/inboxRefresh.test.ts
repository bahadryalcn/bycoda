import { expect, it } from "vitest";
import { dedupeInboxPages, refreshInboxPages, type InboxPages } from "./inboxRefresh";
import type { InboxItem, InboxUnifiedResult } from "./inboxTypes";

/** Thread `id` last active at `at`; the Host lists `at` descending, then id descending. */
function item(id: string, at: number, preview = ""): InboxItem {
  return {
    threadId: id,
    accountId: "a1",
    platform: "instagram",
    kind: "message",
    title: id,
    preview,
    at,
    status: "unread",
    tags: [],
  };
}
function page(items: InboxItem[], next?: string): InboxUnifiedResult {
  return { items, unreadable: [], ...(next ? { next } : {}) };
}
const ids = (data: InboxPages) => data.pages.map((p) => p.items.map((row) => row.threadId));

/** Two loaded pages: t9..t7 then t6..t4, with the cursor of the second one open. */
function loaded(): InboxPages {
  return {
    pages: [
      page([item("t9", 90), item("t8", 80), item("t7", 70)], "70|t7"),
      page([item("t6", 60), item("t5", 50), item("t4", 40)], "40|t4"),
    ],
    pageParams: [undefined, "70|t7"],
  };
}

it("keeps loaded pages and their cursors when the newest page only gained a thread", () => {
  const data = loaded();
  // t10 arrived; the three newest are now t10, t9, t8, so t7 is pushed out of the first page.
  const next = refreshInboxPages(
    data,
    page([item("t10", 100), item("t9", 90), item("t8", 80)], "80|t8"),
  );
  expect(ids(next)).toEqual([["t10", "t9", "t8", "t7"], ["t6", "t5", "t4"]]);
  expect(next.pageParams).toEqual([undefined, "70|t7"]);
  expect(next.pages[1]?.next).toBe("40|t4");
});

it("applies updates and drops threads the newest page no longer lists", () => {
  const data = loaded();
  // t8 got a newer message (moves to the top) and t9 was marked done under a status filter.
  const next = refreshInboxPages(
    data,
    page([item("t8", 120, "new"), item("t7", 70), item("t6", 60)], "60|t6"),
  );
  expect(ids(next)).toEqual([["t8", "t7", "t6"], ["t5", "t4"]]);
  expect(next.pages[0]?.items[0]?.preview).toBe("new");
});

it("restarts from the newest page when it does not reach back into the loaded rows", () => {
  const next = refreshInboxPages(
    loaded(),
    page([item("n3", 300), item("n2", 290), item("n1", 280)], "280|n1"),
  );
  expect(ids(next)).toEqual([["n3", "n2", "n1"]]);
  expect(next.pageParams).toEqual([undefined]);
  expect(next.pages[0]?.next).toBe("280|n1");
});

it("restarts when the list now fits in one page, and refreshes the only loaded page directly", () => {
  const short = refreshInboxPages(loaded(), page([item("t9", 90)]));
  expect(ids(short)).toEqual([["t9"]]);
  const single: InboxPages = { pages: [loaded().pages[0]!], pageParams: [undefined] };
  const next = refreshInboxPages(single, page([item("t10", 100), item("t9", 90)], "90|t9"));
  expect(ids(next)).toEqual([["t10", "t9"]]);
});

it("takes the unreadable accounts from the newest page", () => {
  const unreadable = [
    { accountId: "a1", platform: "instagram" as const, reasonCode: "x", reason: "x" },
  ];
  const next = refreshInboxPages(loaded(), {
    ...page([item("t9", 90), item("t8", 80), item("t7", 70)], "70|t7"),
    unreadable,
  });
  expect(next.pages[0]?.unreadable).toEqual(unreadable);
});

it("lists a thread once when a cursor shift repeats it on two pages", () => {
  const data: InboxPages = {
    pages: [page([item("t3", 30), item("t2", 20)], "20|t2"), page([item("t2", 20), item("t1", 10)])],
    pageParams: [undefined, "20|t2"],
  };
  const deduped = dedupeInboxPages(data);
  expect(ids(deduped)).toEqual([["t3", "t2"], ["t1"]]);
  expect(deduped.pageParams).toBe(data.pageParams);
  expect(dedupeInboxPages(deduped)).toBe(deduped);
});
