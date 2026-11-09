import { describe, expect, it } from "vitest";
import type { InboxItem } from "./githubTasks";
import { DEFAULT_INBOX_FILTERS } from "./inboxFilters";
import { visibleInboxItems, type VisibleInboxItemsInput } from "./inboxVisibleItems";

const item = (number: number, overrides: Partial<InboxItem> = {}): InboxItem => ({
  kind: "pr",
  provider: "github",
  repo: "acme/web",
  number,
  title: `Item ${number}`,
  url: `https://github.com/acme/web/pull/${number}`,
  state: "open",
  updatedAt: `2026-10-0${number}T08:00:00Z`,
  labels: [],
  assignees: [],
  draft: false,
  projectPath: "/work/web",
  ...overrides,
});

const base = (overrides: Partial<VisibleInboxItemsInput> = {}): VisibleInboxItemsInput => ({
  items: [item(1), item(2), item(3, { kind: "issue" })],
  pullRequestsOnly: false,
  prSort: "updated",
  filters: DEFAULT_INBOX_FILTERS,
  search: "",
  source: "github",
  sourceAvailable: true,
  codeScopes: { provider: null, scopes: null, hidden: [] },
  target: null,
  targetItem: null,
  now: Date.parse("2026-10-10T00:00:00Z"),
  ...overrides,
});

describe("visibleInboxItems", () => {
  it("shows nothing for an unavailable source", () => {
    expect(visibleInboxItems(base({ sourceAvailable: false }))).toEqual([]);
  });

  it("limits pull request views to PRs, newest first or by title", () => {
    expect(
      visibleInboxItems(base({ pullRequestsOnly: true })).map((entry) => entry.number),
    ).toEqual([2, 1]);
    expect(
      visibleInboxItems(base({ pullRequestsOnly: true, prSort: "title" })).map(
        (entry) => entry.number,
      ),
    ).toEqual([1, 2]);
  });

  it("keeps a looked-up linked target on top when the loaded list lacks it", () => {
    const looked = item(9, { title: "Linked" });
    const target = { kind: "pr", repo: "acme/web", number: 9, url: looked.url } as const;
    const rows = visibleInboxItems(base({ target, targetItem: looked }));
    expect(rows[0]).toBe(looked);
    expect(rows).toHaveLength(4);
    expect(visibleInboxItems(base({ target, targetItem: looked, source: "linear" }))).not.toContain(
      looked,
    );
  });
});
