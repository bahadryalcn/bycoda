// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { setLanguagePreference } from "../../../shared/i18n";
import { InboxView as RawInboxView } from "./InboxView";
import { withQueryClient } from "../../../../tests/browser/support/queryTest";
import type { InboxItem } from "../model/githubTasks";
import {
  DEFAULT_INBOX_FILTERS,
  saveInboxFilters,
  saveInboxConnections,
  saveInboxSource,
} from "../model/inboxFilters";
import type { LinkedWorkItem } from "../../sessions/model/session";

const { read, invoke } = vi.hoisted(() => ({ read: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
    onFocusChanged: async () => () => {},
    isFullscreen: async () => false,
  }),
}));
vi.mock("./InboxDetail", () => ({
  InboxDetail: ({ item }: { item: InboxItem | null }) =>
    createElement("output", { "aria-label": "Selected inbox item" }, item?.title ?? ""),
}));
vi.mock("./JiraBoardView", () => ({
  JiraBoardView: ({ onSelect }: { onSelect: (issue: never) => void }) =>
    createElement("button", {
      "data-jira-board-fixture": "",
      onClick: () =>
        onSelect({
          id: "jira-1",
          kind: "jira",
          provider: "jira",
          identifier: "ENG-1",
          number: 1,
          title: "Board issue",
          url: "https://acme.atlassian.net/browse/ENG-1",
          state: "open",
          updatedAt: "2026-10-22T08:00:00Z",
          labels: [],
          assignees: [],
          draft: false,
          repo: "ENG",
          projectPath: "/work/project",
        } as never),
    }),
}));
vi.mock("../model/githubTasks", async (original) => ({
  ...(await original<typeof import("../model/githubTasks")>()),
  listInboxItems: read,
  peekInboxList: () => null,
  githubStatus: async () => ({ connected: true }),
}));

const InboxView = withQueryClient(RawInboxView);

it("shows one failure and retry surface when the source has no loaded rows", async () => {
  read.mockResolvedValue({ items: [], errors: { github: "Source unavailable" } });
  await show();
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(container.textContent?.match(/Could not load\./g)).toHaveLength(1);
  const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Retry",
  )!;
  expect(retry).toBeDefined();
  const before = read.mock.calls.length;
  await act(async () => retry.click());
  expect(read.mock.calls.length).toBeGreaterThan(before);
});

/** An Inbox list row by its item title; the title is in the row's accessible name and shared
 *  tooltip now, not a native title attribute. */
function inboxRow(scope: ParentNode, title: string): HTMLButtonElement | null {
  return scope.querySelector<HTMLButtonElement>(`button[aria-label*=": ${title}, "]`);
}

let root: Root;
let container: HTMLDivElement;
const items = (cwd: string): InboxItem[] =>
  [1, 2].map((number) => ({
    kind: "issue",
    number,
    title: `Inbox issue ${number}`,
    url: `https://github.com/acme/web/issues/${number}`,
    state: "open",
    updatedAt: "2026-10-22T08:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
    repo: "acme/web",
    projectPath: cwd,
    provider: "github",
  }));

beforeEach(async () => {
  resetRetainedState();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-index") ? 64 : 480;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  Element.prototype.scrollIntoView = vi.fn();
  await setLanguagePreference("en");
  invoke.mockReset();
  invoke.mockImplementation(async (command) =>
    command.endsWith("_status") ? { connected: false } : [],
  );
  read.mockReset();
  read.mockResolvedValue({ items: items("/work/project"), errors: {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

it("groups Jira view and read/refresh icons beside search and retains the selected view", async () => {
  read.mockResolvedValue({
    items: [{ ...items("/work/project")[0], provider: "jira", kind: "jira", identifier: "ENG-1" }],
    errors: {},
  });
  saveInboxSource("jira");
  saveInboxConnections({
    github: false,
    jira: true,
    linear: false,
    gitlab: false,
    azuredevops: false,
  });
  invoke.mockImplementation(async (command) =>
    command.endsWith("_status") ? { connected: command === "jira_status" } : [],
  );
  await show();
  const group = () =>
    container.querySelector('[data-button-group="joined"][aria-label="Jira view"]')!;
  const button = (label: string) =>
    group().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(group().querySelectorAll("button")).toHaveLength(4);
  expect(
    group().parentElement?.querySelector('input[aria-label="Filter loaded items"]'),
  ).not.toBeNull();
  expect(button("List").getAttribute("aria-pressed")).toBe("true");
  expect(button("Board").getAttribute("aria-pressed")).toBe("false");
  for (const action of group().querySelectorAll("button")) {
    expect(action.textContent?.trim()).toBe("");
    expect(action.getAttribute("data-button-size")).toBe("sm");
  }
  await act(async () => button("Board").click());
  expect(container.querySelector("[data-jira-board-fixture]")).not.toBeNull();
  expect(group().querySelectorAll("button")).toHaveLength(4);
  await act(async () => root.unmount());
  root = createRoot(container);
  await show();
  expect(button("Board").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("List").click());
  expect(button("List").getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector('input[aria-label="Filter loaded items"]')).not.toBeNull();
  await act(async () =>
    button("List").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
  );
  expect(button("Board").getAttribute("aria-pressed")).toBe("true");
  await act(async () =>
    button("Board").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    ),
  );
  expect(button("List").getAttribute("aria-pressed")).toBe("true");
});

it("closes the open Jira board detail on Escape before leaving the Inbox", async () => {
  saveInboxSource("jira");
  saveInboxConnections({
    github: false,
    jira: true,
    linear: false,
    gitlab: false,
    azuredevops: false,
  });
  invoke.mockImplementation(async (command) =>
    command.endsWith("_status") ? { connected: command === "jira_status" } : [],
  );
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      createElement(InboxView, {
        cwd: "/work/project",
        recents: [],
        onClose,
        onAsk: async () => "session",
        onAskRestart: async () => "session",
        onAskMount: () => {},
        onOpenIntegrations: () => {},
      }),
    ),
  );
  const escape = () =>
    act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[data-button-group="joined"] button[aria-label="Board"]')!
      .click(),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>("[data-jira-board-fixture]")!.click(),
  );
  expect(container.querySelector('aside[aria-label="ENG-1"]')).not.toBeNull();
  await escape();
  expect(container.querySelector('aside[aria-label="ENG-1"]')).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  await escape();
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps active filters on an icon button and clears them through the menu", async () => {
  saveInboxFilters({ ...DEFAULT_INBOX_FILTERS, assignedToMe: true });
  await show();
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Filter inbox (filters active)"]',
  )!;
  expect(trigger).not.toBeNull();
  expect(trigger.textContent?.trim()).toBe("");
  expect(trigger.querySelector("svg")).not.toBeNull();
  expect(trigger.parentElement?.querySelector('[data-variant="count"]')?.textContent).toBe("1");
  expect(trigger.parentElement?.querySelectorAll("button")).toHaveLength(1);
  await act(async () => trigger.click());
  const clear = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Clear filters",
  )!;
  expect(clear).not.toBeUndefined();
  await act(async () => clear.click());
  expect(container.querySelector('button[aria-label="Filter inbox"]')).not.toBeNull();
  expect(container.querySelector('[data-filter-trigger] [data-variant="count"]')).toBeNull();
});

it.each([
  ["indeterminate", "running"],
  ["done", "done"],
  ["new", "idle"],
])(
  "presents Jira status category %s without cramped uppercase metadata",
  async (stateType, tone) => {
    const jira: InboxItem = {
      ...items("/work/project")[0],
      provider: "jira",
      kind: "jira",
      identifier: "PFDEV-1037",
      state: "DEVELOPMENT IN PROGRESS",
      stateType,
      teamName: "Acme PF Dev Board",
      labels: [
        { name: "merchant", color: "" },
        { name: "uiux-test", color: "" },
      ],
    };
    read.mockResolvedValue({ items: [jira], errors: {} });
    saveInboxSource("jira");
    saveInboxConnections({
      github: false,
      jira: true,
      linear: false,
      gitlab: false,
      azuredevops: false,
    });
    invoke.mockImplementation(async (command) =>
      command.endsWith("_status") ? { connected: command === "jira_status" } : [],
    );
    await show();
    const row = inboxRow(container, jira.title)!;
    expect(row).not.toBeNull();
    const metadata = row.querySelector("[data-inbox-row-metadata]")!;
    expect(row.textContent).toContain("PFDEV-1037");
    expect(metadata.textContent).toContain("Development in progress");
    expect(metadata.textContent).not.toContain("Issue PFDEV");
    expect(metadata.getAttribute("data-tone")).toBe(tone);
    expect(row.textContent).toContain("Acme PF Dev Board");
    expect(row.getAttribute("aria-label")).toContain("merchant, uiux-test");
    await act(async () => row.click());
    expect(row.getAttribute("aria-current")).toBe("true");
  },
);

it("bounds loaded rows and restores a scrolled position beyond the initial window", async () => {
  const base = items("/work/project")[0];
  read.mockResolvedValue({
    items: Array.from({ length: 100 }, (_, index) => ({
      ...base,
      number: index + 1,
      title: `Inbox issue ${index + 1}`,
    })),
    errors: {},
  });
  await show();
  const rows = () =>
    container.querySelectorAll<HTMLButtonElement>('button[aria-label*=": Inbox issue "]');
  expect(rows().length).toBeLessThan(64);
  const scroller = container.querySelector<HTMLElement>("[data-continuous-list]")!;
  scroller.scrollTop = 1920;
  await act(async () => scroller.dispatchEvent(new Event("scroll")));
  expect(inboxRow(container, "Inbox issue 40")).not.toBeNull();
  expect(rows().length).toBeLessThan(64);
  await act(async () => root.unmount());
  root = createRoot(container);
  await show();
  const restoredScroller = container.querySelector<HTMLElement>("[data-continuous-list]")!;
  expect(restoredScroller.scrollTop).toBe(1920);
  expect(inboxRow(container, "Inbox issue 50")).not.toBeNull();
  expect(rows().length).toBeLessThan(64);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function show(
  cwd = "/work/project",
  target?: LinkedWorkItem,
  onPullRequestsOnlyChange?: (value: boolean) => void,
  pullRequestsOnly = false,
) {
  await act(async () =>
    root.render(
      createElement(InboxView, {
        cwd,
        target,
        onPullRequestsOnlyChange,
        pullRequestsOnly,
        recents: [],
        onAsk: async () => "session",
        onAskRestart: async () => "session",
        onAskMount: () => {},
        onOpenIntegrations: () => {},
      }),
    ),
  );
}

it("restores the selected inbox item and list position after leaving the tool", async () => {
  await show();
  const second = inboxRow(container, "Inbox issue 2")!;
  expect(second).not.toBeNull();
  await act(async () => second.click());
  const scroller = second.closest("[data-continuous-list]")!;
  scroller.scrollTop = 420;
  scroller.dispatchEvent(new Event("scroll"));
  await act(async () => root.unmount());
  root = createRoot(container);
  await show();
  const restored = inboxRow(container, "Inbox issue 2")!;
  expect(restored.getAttribute("aria-current")).toBe("true");
  expect(restored.closest("[data-continuous-list]")!.scrollTop).toBe(420);
  await act(async () => root.unmount());
  root = createRoot(container);
  const remoteCwd = "remote://other-host/work/project";
  read.mockResolvedValue({ items: items(remoteCwd), errors: {} });
  await show(remoteCwd);
  const firstOnOtherHost = inboxRow(container, "Inbox issue 1")!;
  expect(firstOnOtherHost.getAttribute("aria-current")).toBe("true");
  expect(firstOnOtherHost.closest("[data-continuous-list]")!.scrollTop).toBe(0);
  await act(async () => root.unmount());
  root = createRoot(container);
  await show("/work/project", {
    kind: "issue",
    repo: "acme/web",
    number: 1,
    url: "https://github.com/acme/web/issues/1",
  });
  expect(inboxRow(container, "Inbox issue 1")?.getAttribute("aria-current")).toBe("true");
});

it("returns from the narrow detail view without clearing the selected item or list position", async () => {
  await show();
  const second = inboxRow(container, "Inbox issue 2")!;
  const scroller = second.closest("[data-continuous-list]")!;
  scroller.scrollTop = 420;
  await act(async () => second.click());
  expect(container.querySelector(".inbox-list-detail")?.getAttribute("data-detail-open")).toBe(
    "true",
  );
  const back = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Back",
  )!;
  await act(async () => back.click());
  expect(container.querySelector(".inbox-list-detail")?.getAttribute("data-detail-open")).toBe(
    "false",
  );
  expect(second.getAttribute("aria-current")).toBe("true");
  expect(scroller.scrollTop).toBe(420);
});

it("offers the pull-request mode inside Inbox and keeps the all-items route reachable", async () => {
  const change = vi.fn();
  await show("/work/project", undefined, change);
  const toggle = () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Pull requests",
    )!;
  expect(toggle().getAttribute("aria-pressed")).toBe("false");
  await act(async () => toggle().click());
  expect(change).toHaveBeenLastCalledWith(true);
  await show("/work/project", undefined, change, true);
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector("h2")?.textContent).toBe("Inbox");
  await act(async () => toggle().click());
  expect(change).toHaveBeenLastCalledWith(false);
});

it("switches GitHub lists by kind and retains the chosen row layout when Inbox reopens", async () => {
  const issues = items("/work/project");
  const pr: InboxItem = {
    ...issues[0],
    kind: "pr",
    number: 16,
    title: "Review the new Inbox layout",
    url: "https://github.com/acme/web/pull/16",
    labels: [{ name: "design", color: "" }],
  };
  read.mockResolvedValue({ items: [...issues, pr], errors: {} });
  const kind = (label: string) =>
    container.querySelector<HTMLButtonElement>(`[role="radio"][aria-label="${label}"]`)!;

  await show();
  expect(kind("Issues").getAttribute("aria-checked")).toBe("true");
  expect(inboxRow(container, pr.title)).toBeNull();
  await act(async () => kind("Pull requests").click());
  expect(inboxRow(container, issues[0].title)).toBeNull();
  expect(inboxRow(container, pr.title)?.getAttribute("aria-current")).toBe("true");
  expect(inboxRow(container, pr.title)?.textContent).not.toContain("design");

  const layout = container.querySelector<HTMLButtonElement>('button[aria-label="List view"]')!;
  await act(async () => layout.click());
  const comfortable =
    document.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"][data-menu-id="comfortable"]',
    ) ??
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
      (option) => option.textContent?.trim() === "Comfortable",
    )!;
  await act(async () => comfortable.click());
  expect(inboxRow(container, pr.title)?.parentElement?.textContent).toContain("design");
  await act(async () => root.unmount());
  root = createRoot(container);
  await show();
  expect(kind("Pull requests").getAttribute("aria-checked")).toBe("true");
  expect(inboxRow(container, pr.title)?.parentElement?.textContent).toContain("design");
});

it("reveals a linked GitHub pull request when Issues was the active list", async () => {
  const issue = items("/work/project")[0];
  const pr: InboxItem = {
    ...issue,
    kind: "pr",
    number: 16,
    title: "Review the linked change",
    url: "https://github.com/acme/web/pull/16",
  };
  read.mockResolvedValue({ items: [issue, pr], errors: {} });
  await show();
  expect(inboxRow(container, issue.title)).not.toBeNull();
  await show("/work/project", { kind: "pr", number: pr.number, repo: pr.repo, url: pr.url });
  expect(inboxRow(container, issue.title)).toBeNull();
  expect(inboxRow(container, pr.title)?.getAttribute("aria-current")).toBe("true");
});

it("opens Pull requests for a saved legacy filter that hid issues", async () => {
  saveInboxFilters({ ...DEFAULT_INBOX_FILTERS, hiddenKinds: ["issue"] });
  await show();
  const pulls = container.querySelector('[role="radio"][aria-label="Pull requests"]');
  expect(pulls?.getAttribute("aria-checked")).toBe("true");
});
