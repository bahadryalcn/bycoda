// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxList } from "./InboxList";
import { UnreadableNotice } from "./InboxNotices";
import type { InboxItem } from "./inboxTypes";

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

const item = (
  overrides: Partial<InboxItem> & Pick<InboxItem, "threadId" | "title">,
): InboxItem => ({
  accountId: "x-main",
  platform: "x",
  kind: "message",
  preview: "Hello there",
  at: Date.now(),
  status: "unread",
  tags: [],
  ...overrides,
});

function renderList(props: Partial<Parameters<typeof InboxList>[0]> = {}) {
  const onSelect = vi.fn();
  const onMore = vi.fn();
  act(() =>
    root.render(
      createElement(InboxList, {
        items: [
          item({ threadId: "t-1", title: "Ana", tags: ["vip"] }),
          item({
            threadId: "t-2",
            title: "Bo",
            platform: "instagram",
            kind: "comment",
            status: "replied",
          }),
        ],
        selectedId: "t-2",
        loading: false,
        hasMore: true,
        loadingMore: false,
        onSelect,
        onMore,
        ...props,
      }),
    ),
  );
  return { onSelect, onMore };
}

it("renders one row per conversation with its title, status and tags", () => {
  renderList();
  const rows = [...element.querySelectorAll("li button")] as HTMLButtonElement[];
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain("Ana");
  expect(rows[0].textContent).toContain("Unread");
  expect(rows[0].textContent).toContain("vip");
  expect(rows[1].textContent).toContain("Replied");
});

it("marks the selected conversation with aria-current", () => {
  renderList();
  const rows = [...element.querySelectorAll("li button")] as HTMLButtonElement[];
  expect(rows[0].getAttribute("aria-current")).toBeNull();
  expect(rows[1].getAttribute("aria-current")).toBe("true");
});

it("selects a conversation on click and loads the next page on Load more", () => {
  const { onSelect, onMore } = renderList();
  const rows = [...element.querySelectorAll("li button")] as HTMLButtonElement[];
  act(() => rows[0].click());
  expect(onSelect).toHaveBeenCalledWith("t-1");
  const more = [...element.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Load more"),
  ) as HTMLButtonElement;
  act(() => more.click());
  expect(onMore).toHaveBeenCalledOnce();
});

it("states the account it cannot read instead of showing an empty list", () => {
  act(() =>
    root.render(
      createElement(UnreadableNotice, {
        accounts: [
          {
            accountId: "li-main",
            platform: "linkedin",
            reasonCode: "browser.no_recipe",
            reason: "No recipe",
          },
        ],
        names: { "li-main": "Company page" },
      }),
    ),
  );
  expect(element.textContent).toContain(
    "Can't read messages on Company page: Not available in the browser yet",
  );
});
