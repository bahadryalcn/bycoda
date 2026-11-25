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

// #670 gives each virtual item its own conversation button and may add a tag overflow button.
const conversationButtons = () => [
  ...element.querySelectorAll<HTMLButtonElement>('[role="listitem"] button.inbox-row'),
];

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
        stateKey: "social:1:acc::all",
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

it("renders one row per conversation with its title and status, and the unread state once", () => {
  renderList();
  const rows = conversationButtons();
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain("Ana");
  expect(rows[0].querySelector('[role="img"][aria-label="Unread"]')).not.toBeNull();
  expect(rows[0].textContent).not.toContain("Unread");
  expect(rows[1].querySelector('[aria-label="Replied"]')).not.toBeNull();
});

it("keeps tags beside the row button, so the row is one interactive control", () => {
  renderList();
  const rows = conversationButtons();
  expect(rows[0].querySelector("button")).toBeNull();
  expect(rows[0].textContent).not.toContain("vip");
  const tags = element.querySelector<HTMLButtonElement>('button[aria-label="Tags"]')!;
  expect(tags).toBeDefined();
  act(() => tags.click());
  expect(document.body.textContent).toContain("vip");
});

it("marks the selected conversation with aria-current", () => {
  renderList();
  const rows = conversationButtons();
  expect(rows[0].getAttribute("aria-current")).toBeNull();
  expect(rows[1].getAttribute("aria-current")).toBe("true");
});

it("selects a conversation on click and loads the next page on Load more", () => {
  const { onSelect, onMore } = renderList();
  const rows = conversationButtons();
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
