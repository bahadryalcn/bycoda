// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchView } from "./SearchView";
import { SessionMessageSearch } from "../model/appSearch";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { newSession } from "../../sessions/model/session";

const index = vi.hoisted(() => ({
  load: vi.fn(),
  rank: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock("../../../app/shell/TitleBar", () => ({ OverlayNav: () => null }));
vi.mock("../../../app/shell/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("../../files/model/fileIndex", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../files/model/fileIndex")>();
  return {
    ...original,
    peekProjectFiles: () => [],
    loadProjectFiles: index.load,
    rankProjectFiles: index.rank,
    subscribeProjectFiles: (listener: () => void) => {
      index.listeners.add(listener);
      return () => index.listeners.delete(listener);
    },
    recentOpenedFiles: () => [],
  };
});
vi.mock("../model/useConversationSearch", () => ({
  useConversationSearch: () => ({
    result: { sessions: [], pending: 0, truncated: false },
    loading: false,
    error: null,
  }),
}));
vi.mock("../model/useProjectFileSearch", () => ({
  useProjectFileSearch: () => ({
    result: { matches: [], truncated: false },
    loading: false,
    error: null,
  }),
}));
vi.mock("../../group-lock/hooks/useGroupLock", () => {
  const snapshot = { lockedGroupIds: new Set<string>(), lockedProjectKeys: new Set<string>() };
  return { useLockSnapshot: () => snapshot };
});

let root: Root;
let host: HTMLDivElement;
let props: ComponentProps<typeof SearchView>;
beforeEach(() => {
  resetRetainedState();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  index.load.mockReset().mockResolvedValue([]);
  index.rank.mockReset().mockReturnValue([]);
  index.listeners.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    cwd: "/repo",
    open: true,
    recents: [],
    history: [],
    sessions: [
      {
        ...newSession("codex", "/repo"),
        title: "needle",
        blocks: [{ id: "block", role: "user", text: "needle" }],
      },
    ],
    onClose: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenSession: vi.fn(),
    onOpenProject: vi.fn(),
  };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(createElement(SearchView, props)));
const scope = (name: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((button) => button.textContent === name)!.click();
  });
const typeQuery = (query: string) =>
  act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

it.each(["projects", "conversations"] as const)(
  "does not start file work before applying an initial %s request",
  async (requestedScope) => {
    props = { ...props, request: { scope: requestedScope, query: "needle" } };
    await render();
    expect(index.load).not.toHaveBeenCalled();
    expect(index.listeners.size).toBe(0);
    expect(index.rank).not.toHaveBeenCalled();
  },
);

it.each(["Projects", "Conversations"])(
  "releases the file-index subscription in %s",
  async (name) => {
    await render();
    expect(index.listeners.size).toBe(1);
    await scope(name);
    expect(index.listeners.size).toBe(0);
    index.load.mockClear();
    for (const listener of index.listeners) listener();
    expect(index.load).not.toHaveBeenCalled();
    await scope("All");
    expect(index.listeners.size).toBe(1);
    expect(index.load).toHaveBeenCalled();
  },
);

it.each(["Files", "Projects", "Conversations"])(
  "skips local transcript scans in %s and resumes current All results",
  async (name) => {
    const messages = vi.spyOn(SessionMessageSearch.prototype, "search");
    await render();
    await scope(name);
    messages.mockClear();
    index.rank.mockClear();
    await typeQuery("needle");
    expect(messages).not.toHaveBeenCalled();
    if (name !== "Files") expect(index.rank).not.toHaveBeenCalled();
    props = { ...props, sessions: props.sessions.map((session) => ({ ...session })) };
    await render();
    expect(messages).not.toHaveBeenCalled();
    await scope("All");
    expect(messages).toHaveBeenCalled();
    expect(host.textContent).toContain("needle");
  },
);

it("skips retained closed search projections when loaded sessions change", async () => {
  const messages = vi.spyOn(SessionMessageSearch.prototype, "search");
  await render();
  await typeQuery("needle");
  messages.mockClear();
  index.rank.mockClear();
  props = { ...props, open: false, sessions: props.sessions.map((session) => ({ ...session })) };
  await render();
  expect(messages).not.toHaveBeenCalled();
  expect(index.rank).not.toHaveBeenCalled();
  expect(index.listeners.size).toBe(0);
});
