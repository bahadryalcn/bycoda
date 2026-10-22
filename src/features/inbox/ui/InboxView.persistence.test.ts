// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { setLanguagePreference } from "../../../shared/i18n";
import { InboxView as RawInboxView } from "./InboxView";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { InboxItem } from "../model/githubTasks";
import type { LinkedWorkItem } from "../../sessions/model/session";
import { LIST_PAGE_SIZE } from "../../../shared/lib/listWindow";

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
let root: Root;
let container: HTMLDivElement;
let revealMore: (() => void) | undefined;
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
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        revealMore = () => callback([{ isIntersecting: true }]);
      }
      observe() {}
      disconnect() {}
    },
  );
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

it("restores the loaded list window before restoring a position beyond its first page", async () => {
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
  const rows = () => container.querySelectorAll<HTMLButtonElement>('button[title^="Inbox issue "]');
  expect(rows()).toHaveLength(LIST_PAGE_SIZE);
  await act(async () => revealMore!());
  expect(rows()).toHaveLength(LIST_PAGE_SIZE * 2);
  const scroller = rows()[0].closest("ul")!.parentElement!;
  scroller.scrollTop = 2440;
  scroller.dispatchEvent(new Event("scroll"));
  await act(async () => root.unmount());
  root = createRoot(container);
  await show();
  expect(rows()).toHaveLength(LIST_PAGE_SIZE * 2);
  expect(rows()[0].closest("ul")!.parentElement!.scrollTop).toBe(2440);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
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
  const second = container.querySelector<HTMLButtonElement>('button[title="Inbox issue 2"]')!;
  expect(second).not.toBeNull();
  await act(async () => second.click());
  const scroller = second.closest("ul")!.parentElement!;
  scroller.scrollTop = 420;
  scroller.dispatchEvent(new Event("scroll"));
  await act(async () => root.unmount());
  root = createRoot(container);
  await show();
  const restored = container.querySelector<HTMLButtonElement>('button[title="Inbox issue 2"]')!;
  expect(restored.getAttribute("aria-current")).toBe("true");
  expect(restored.closest("ul")!.parentElement!.scrollTop).toBe(420);
  await act(async () => root.unmount());
  root = createRoot(container);
  const remoteCwd = "remote://other-host/work/project";
  read.mockResolvedValue({ items: items(remoteCwd), errors: {} });
  await show(remoteCwd);
  const firstOnOtherHost = container.querySelector<HTMLButtonElement>(
    'button[title="Inbox issue 1"]',
  )!;
  expect(firstOnOtherHost.getAttribute("aria-current")).toBe("true");
  expect(firstOnOtherHost.closest("ul")!.parentElement!.scrollTop).toBe(0);
  await act(async () => root.unmount());
  root = createRoot(container);
  await show("/work/project", {
    kind: "issue",
    repo: "acme/web",
    number: 1,
    url: "https://github.com/acme/web/issues/1",
  });
  expect(
    container.querySelector('button[title="Inbox issue 1"]')?.getAttribute("aria-current"),
  ).toBe("true");
});
