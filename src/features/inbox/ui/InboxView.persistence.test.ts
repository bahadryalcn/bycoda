// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { setLanguagePreference } from "../../../shared/i18n";
import { InboxView as RawInboxView } from "./InboxView";
import { withQueryClient } from "../../../../tests/browser/support/queryTest";
import type { InboxItem } from "../model/githubTasks";
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
vi.mock("../model/githubTasks", async (original) => ({
  ...(await original<typeof import("../model/githubTasks")>()),
  listInboxItems: read,
  peekInboxList: () => null,
  githubStatus: async () => ({ connected: true }),
}));

const InboxView = withQueryClient(RawInboxView);

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
  scroller.scrollTop = 2440;
  await act(async () => scroller.dispatchEvent(new Event("scroll")));
  expect(inboxRow(container, "Inbox issue 40")).not.toBeNull();
  expect(rows().length).toBeLessThan(64);
  await act(async () => root.unmount());
  root = createRoot(container);
  await show();
  const restoredScroller = container.querySelector<HTMLElement>("[data-continuous-list]")!;
  expect(restoredScroller.scrollTop).toBe(2440);
  expect(inboxRow(container, "Inbox issue 40")).not.toBeNull();
  expect(rows().length).toBeLessThan(64);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function show(cwd = "/work/project", target?: LinkedWorkItem) {
  await act(async () =>
    root.render(
      createElement(InboxView, {
        cwd,
        target,
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
