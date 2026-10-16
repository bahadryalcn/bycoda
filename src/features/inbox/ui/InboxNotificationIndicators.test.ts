// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { InboxView as RawInboxView } from "./InboxView";
import { withQueryClient } from "../../../../tests/browser/queryTest";
const InboxView = withQueryClient(RawInboxView);
import { inboxItemKey, type InboxItem } from "../model/githubTasks";
import { isInboxEntryUnseen, seedInboxSeenIfNeeded } from "../model/inboxSeen";
import { saveInboxConnections, saveInboxSource } from "../model/inboxFilters";
import { updateNotificationPreferences } from "../../notifications/model/notificationPreferences";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";

const { listInboxItems } = vi.hoisted(() => ({ listInboxItems: vi.fn() }));
vi.mock("../model/githubTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/githubTasks")>()),
  listInboxItems,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn().mockRejectedValue(new Error("No native bridge")),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
    onFocusChanged: async () => () => {},
    isFullscreen: async () => false,
  }),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  resetRetainedState();
  vi.mocked(invoke).mockRejectedValue(new Error("No native bridge"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-15T12:00:00Z"));
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("filters the cached Inbox locally and reuses fresh data when reopened", async () => {
  saveInboxConnections({ github: true, gitlab: false, linear: false, azuredevops: false });
  saveInboxSource("github");
  const base: InboxItem = {
    provider: "github",
    kind: "issue",
    repo: "acme/app",
    number: 1,
    title: "Alpha issue",
    url: "https://github.com/acme/app/issues/1",
    state: "open",
    updatedAt: "2030-01-15T11:59:00Z",
    labels: [],
    assignees: [],
    draft: false,
    projectPath: "/tmp/app",
  };
  listInboxItems.mockResolvedValue({
    items: [base, { ...base, number: 2, title: "Beta issue" }],
    errors: {},
  });
  const render = () =>
    act(async () =>
      root.render(
        createElement(InboxView, {
          cwd: "/tmp/app",
          recents: [],
          onAsk: async () => "",
          onAskRestart: async () => "",
          onAskMount: () => {},
          onOpenIntegrations: () => {},
        }),
      ),
    );
  await render();
  expect(container.querySelector('button[title="Beta issue"]')).not.toBeNull();
  const reads = listInboxItems.mock.calls.length;
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Filter inbox"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Alpha");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector('button[title="Alpha issue"]')).not.toBeNull();
  expect(container.querySelector('button[title="Beta issue"]')).toBeNull();
  expect(listInboxItems.mock.calls).toHaveLength(reads);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(listInboxItems.mock.calls).toHaveLength(reads);
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Filter inbox"]')?.value).toBe("Alpha");
  expect(container.querySelector('button[title="Alpha issue"]')).not.toBeNull();
  expect(container.querySelector('button[title="Beta issue"]')).toBeNull();
});

it("reports a failed mark-all write in Inbox and clears the error after retry", async () => {
  const item: InboxItem = {
    provider: "github",
    kind: "issue",
    repo: "acme/app",
    number: 42,
    title: "Unread issue",
    url: "https://github.com/acme/app/issues/42",
    state: "open",
    updatedAt: "2030-01-15T11:59:00Z",
    labels: [],
    assignees: [],
    draft: false,
    projectPath: "/tmp/app",
  };
  const entry = { key: inboxItemKey(item), updatedAt: item.updatedAt };
  seedInboxSeenIfNeeded([{ ...entry, updatedAt: "2030-01-14T12:00:00Z" }]);
  saveInboxConnections({
    github: true,
    gitlab: false,
    linear: false,
    azuredevops: false,
  });
  saveInboxSource("github");
  listInboxItems.mockResolvedValue({ items: [item], errors: {} });
  await act(async () =>
    root.render(
      createElement(InboxView, {
        cwd: "/tmp/app",
        recents: [],
        onAsk: async () => "",
        onAskRestart: async () => "",
        onAskMount: () => {},
        onOpenIntegrations: () => {},
      }),
    ),
  );
  const markAll = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Mark all as read"]',
  )!;
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("Storage full");
  });
  act(() => markAll.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not save read status",
  );
  expect(isInboxEntryUnseen(entry)).toBe(true);
  expect(markAll.disabled).toBe(false);
  write.mockRestore();
  act(() => markAll.click());
  expect(isInboxEntryUnseen(entry)).toBe(false);
  expect(markAll.disabled).toBe(true);
  // The detail panel can independently report an unavailable native bridge.
  // Retrying read status clears its own error without suppressing other errors.
  expect(
    Array.from(container.querySelectorAll('[role="alert"]')).some((alert) =>
      alert.textContent?.includes("Could not save read status"),
    ),
  ).toBe(false);
});

it.each([
  ["github", "issue", "issues", "https://github.com/acme/app/issues/42", "local:/tmp/app"],
  ["github", "pr", "pullRequests", "https://github.com/acme/app/pull/42", "local:/tmp/app"],
  [
    "gitlab",
    "issue",
    "issues",
    "https://gitlab.example.com/acme/app/-/issues/42",
    "local:/tmp/app",
  ],
  [
    "gitlab",
    "pr",
    "pullRequests",
    "https://gitlab.example.com/acme/app/-/merge_requests/42",
    "local:/tmp/app",
  ],
  ["linear", "linear", "issues", "https://linear.app/acme/issue/ENG-42", "linear:project:roadmap"],
] as const)(
  "keeps the %s %s visibly unread until opened even with its category off or project muted",
  async (provider, kind, category, url, projectId) => {
    const item: InboxItem = {
      provider,
      kind,
      url,
      repo: "acme/app",
      number: 42,
      title: "Notification indicator regression",
      state: "open",
      updatedAt: "2030-01-15T11:59:00Z",
      labels: [],
      assignees: [],
      draft: false,
      projectPath: "/tmp/app",
      ...(provider === "linear"
        ? {
            id: "linear-42",
            identifier: "ENG-42",
            projectId: "roadmap",
            teamId: "engineering",
          }
        : {}),
    };
    const entry = { key: inboxItemKey(item), updatedAt: item.updatedAt };
    seedInboxSeenIfNeeded([{ ...entry, updatedAt: "2030-01-14T12:00:00Z" }]);
    saveInboxConnections({
      github: true,
      gitlab: true,
      linear: true,
      azuredevops: true,
    });
    saveInboxSource(provider);
    listInboxItems.mockResolvedValue({ items: [item], errors: {} });
    updateNotificationPreferences([projectId], { disabled: [category] });
    const mount = () =>
      act(async () =>
        root.render(
          createElement(InboxView, {
            cwd: "/tmp/app",
            recents: [],
            onAsk: async () => "",
            onAskRestart: async () => "",
            onAskMount: () => {},
            onOpenIntegrations: () => {},
          }),
        ),
      );
    await mount();
    let card = container.querySelector<HTMLButtonElement>(
      'button[title="Notification indicator regression"]',
    )!;
    expect(card).not.toBeNull();
    expect(card.getAttribute("aria-label")).toContain(", new");

    expect(card.querySelector(".bg-accent")).not.toBeNull();
    expect(isInboxEntryUnseen(entry)).toBe(true);

    act(() =>
      updateNotificationPreferences([projectId], {
        disabled: [],
        mutedUntil: Date.now() + 1000,
      }),
    );
    expect(card.getAttribute("aria-label")).toContain(", new");
    // Closing and reopening Inbox while muted must not hide or consume unread state.
    act(() => root.render(null));
    await mount();
    card = container.querySelector<HTMLButtonElement>(
      'button[title="Notification indicator regression"]',
    )!;
    expect(card.getAttribute("aria-label")).toContain(", new");
    expect(isInboxEntryUnseen(entry)).toBe(true);
    act(() => card.click());
    expect(isInboxEntryUnseen(entry)).toBe(false);
    expect(card.getAttribute("aria-label")).not.toContain(", new");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(card.getAttribute("aria-label")).not.toContain(", new");
    expect(isInboxEntryUnseen(entry)).toBe(false);
  },
);
