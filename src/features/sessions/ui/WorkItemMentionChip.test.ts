// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => undefined),
}));

import { openUrl } from "@tauri-apps/plugin-opener";
import { rememberWorkItemMention, type InboxItem } from "../../inbox/public/workItemMentions";
import { takeInboxItemRequest } from "../../inbox/model/inboxItemRequest";
import { WorkItemMentionText } from "./ChatCitationText";
import { ComposerWorkItemToken, WorkItemMentionCwd } from "./WorkItemMentionChip";

let host: HTMLDivElement;
let root: Root;

const issue: InboxItem = {
  provider: "jira",
  kind: "issue",
  number: 834,
  identifier: "PFDEV-834",
  repo: "",
  title: "Checkout fails on retry",
  state: "In Progress",
  url: "https://example.atlassian.net/browse/PFDEV-834",
  updatedAt: "",
  labels: [],
  assignees: [{ login: "Ada" } as InboxItem["assignees"][number]],
  draft: false,
  projectPath: "/repo",
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  rememberWorkItemMention(issue);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  takeInboxItemRequest();
});

function render(text: string) {
  act(() =>
    root.render(
      createElement(
        WorkItemMentionCwd,
        { value: "/repo" },
        createElement(WorkItemMentionText, { text }),
      ),
    ),
  );
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find((node) =>
    node.textContent?.includes(label),
  );
  if (!match) throw new Error(`No button ${label}`);
  return match;
}

it("shows a sent tracker token as a chip that keeps the full token as text", () => {
  render("Look at @jira:PFDEV-834 please");
  const chip = host.querySelector("[data-work-item-mention]")!;
  expect(chip.textContent).toBe("@jira:PFDEV-834");
  expect(chip.closest("button")).not.toBeNull();
});

it("keeps tracker identity visible without a project or lookup authority", () => {
  const text = "@jira:PFDEV-834 @gh:owner/repo#42";
  act(() => root.render(createElement(WorkItemMentionText, { text })));
  expect(host.textContent).toBe(text);
  expect(host.querySelectorAll("[data-work-item-mention] svg")).toHaveLength(2);
  expect(host.querySelector("button")).toBeNull();
});

it("opens the item's details and hands it to the Inbox or the browser", async () => {
  render("@jr:PFDEV-834");
  await act(async () => host.querySelector("button")!.click());
  expect(document.body.textContent).toContain("Checkout fails on retry");
  expect(document.body.textContent).toContain("Ada · In Progress");

  await act(async () => button("Open in browser").click());
  expect(openUrl).toHaveBeenCalledWith(issue.url);

  await act(async () => button("Show in Inbox").click());
  expect(takeInboxItemRequest()).toBe(issue);
});

it("keeps the draft token's characters and opens the card from the tracker mark", async () => {
  act(() =>
    root.render(
      createElement(
        WorkItemMentionCwd,
        { value: "/repo" },
        createElement(ComposerWorkItemToken, { token: "@jira:PFDEV-834" }),
      ),
    ),
  );
  expect(host.textContent).toBe("@jira:PFDEV-834");
  const mark = host.querySelector<HTMLElement>("[data-work-item-open]")!;
  const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  mark.dispatchEvent(press);
  expect(press.defaultPrevented).toBe(true);
  await act(async () => mark.click());
  expect(document.body.textContent).toContain("Checkout fails on retry");
});
