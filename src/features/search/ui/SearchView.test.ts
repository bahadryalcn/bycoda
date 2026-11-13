// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchView } from "./SearchView";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import type { ProjectFile } from "../../../platform/tauri/fs";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import { newSession } from "../../sessions/model/session";

const index = vi.hoisted(() => ({
  files: new Map<string, ProjectFile[]>(),
  listeners: new Set<() => void>(),
  load: vi.fn<(cwd: string) => Promise<ProjectFile[]>>(),
  search: vi.fn(),
  conversationPending: 0,
}));

vi.mock("../../../app/shell/TitleBar", () => ({ OverlayNav: () => null }));
vi.mock("../../../app/shell/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("../../files/model/fileIndex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../files/model/fileIndex")>()),
  peekProjectFiles: (cwd: string) => index.files.get(cwd) ?? null,
  loadProjectFiles: index.load,
  subscribeProjectFiles: (listener: () => void) => {
    index.listeners.add(listener);
    return () => index.listeners.delete(listener);
  },
  recentOpenedFiles: () => [],
}));
vi.mock("../model/useConversationSearch", () => ({
  useConversationSearch: () => ({
    result: { sessions: [], pending: index.conversationPending, truncated: false },
    loading: false,
    error: null,
  }),
}));
vi.mock("../model/useProjectFileSearch", () => ({
  useProjectFileSearch: (...args: unknown[]) => {
    index.search(...args);
    return {
      result: { matches: [], truncated: false },
      loading: false,
      error: null,
      retry: vi.fn(),
    };
  },
}));
vi.mock("../../group-lock/hooks/useGroupLock", () => {
  const snapshot = { lockedGroupIds: new Set<string>(), lockedProjectKeys: new Set<string>() };
  return { useLockSnapshot: () => snapshot };
});
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  index.files.clear();
  index.listeners.clear();
  index.load.mockReset().mockImplementation(async (cwd) => index.files.get(cwd) ?? []);
  index.search.mockClear();
  index.conversationPending = 0;
  localStorage.clear();
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = (
  cwd = "/repo",
  open = true,
  overrides: Partial<ComponentProps<typeof SearchView>> = {},
) =>
  act(async () =>
    root.render(
      createElement(SearchView, {
        cwd,
        open,
        recents: [],
        history: [],
        sessions: [],
        onClose: vi.fn(),
        onOpenFile: vi.fn(),
        onOpenSession: vi.fn(),
        onOpenProject: vi.fn(),
        ...overrides,
      }),
    ),
  );

const file = (name: string, cwd = "/repo"): ProjectFile => ({
  name,
  path: `${cwd}/${name}`,
  relative: name,
});

it("keeps archived history titles and loaded messages out of All results", async () => {
  const archived: SessionSummary = {
    id: "archived",
    cwd: "/repo",
    harness: "cursor",
    model: "model",
    runtimeMode: "supervised",
    title: "needle archived title",
    createdAt: 1,
    updatedAt: 2,
    archived: true,
  };
  const live = newSession("cursor", "/repo");
  live.id = archived.id;
  live.title = "needle loaded title";
  live.blocks = [{ id: "message", role: "user", text: "needle archived message" }];
  const storedArchived = { ...archived, id: "stored-archived", title: "needle stored archive" };
  const visible = { ...archived, id: "visible", title: "needle visible title", archived: false };
  await render("/repo", true, { history: [archived, storedArchived, visible], sessions: [live] });
  await typeQuery("needle");

  expect(host.textContent).toContain("needle visible title");
  expect(host.textContent).not.toContain("needle archived title");
  expect(host.textContent).not.toContain("needle loaded title");
  expect(host.textContent).not.toContain("needle stored archive");
  expect(host.textContent).not.toContain("needle archived message");
});

it("retains the exact active destination when asynchronous filename arrivals reorder results", async () => {
  index.files.set("/repo", [file("needle-a.ts"), file("needle-b.ts")]);
  const onOpenFile = vi.fn();
  await render("/repo", true, { onOpenFile });
  await typeQuery("needle");
  const input = host.querySelector<HTMLInputElement>("input")!;
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  expect(host.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(
    "needle-b.ts",
  );
  await act(async () => {
    index.files.set("/repo", [file("needle-0.ts"), file("needle-a.ts"), file("needle-b.ts")]);
    notifyIndex();
  });
  const selected = host.querySelector('[role="option"][aria-selected="true"]')!;
  expect(selected.textContent).toContain("needle-b.ts");
  expect(input.getAttribute("aria-activedescendant")).toBe(selected.id);
  expect(input.getAttribute("aria-controls")).toBe(host.querySelector('[role="listbox"]')?.id);
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(onOpenFile).toHaveBeenCalledWith("/repo/needle-b.ts", undefined, { exact: true });
});

it("names incomplete application indexing instead of claiming a confirmed empty result", async () => {
  index.conversationPending = 3;
  await render();
  await typeQuery("missing");
  expect(host.textContent).toContain("No indexed matches yet");
  expect(host.textContent).toContain("Application-wide indexing");
  expect(host.textContent).not.toContain("No results");
});

it("resets to the new query's first destination instead of retaining an old deferred hit", async () => {
  index.files.set("/repo", [file("needle-0.ts"), file("needle-a.ts")]);
  await render();
  await typeQuery("needle-a");
  expect(host.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(
    "needle-a.ts",
  );
  await typeQuery("needle");
  expect(host.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(
    "needle-0.ts",
  );
});

it("does not open a stale deferred result through pointer activation with a newer query", async () => {
  index.files.set("/repo", [file("needle.ts"), file("other.ts")]);
  const onOpenFile = vi.fn();
  const onClose = vi.fn();
  await render("/repo", true, { onOpenFile, onClose });
  await typeQuery("needle");
  act(() => {
    flushSync(() => {
      const input = host.querySelector<HTMLInputElement>("input")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "other",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const stale = host.querySelector<HTMLButtonElement>('[role="option"]')!;
    expect(stale.textContent).toContain("needle.ts");
    expect(host.querySelector("input")?.getAttribute("aria-activedescendant")).toBeNull();
    stale.click();
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
function notifyIndex() {
  for (const listener of index.listeners) listener();
}
async function typeQuery(query: string) {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });
}

it("searches remote filenames and enables the owning-host content route in Files", async () => {
  const cwd = "remote://environment/repo";
  index.files.set(cwd, [file("needle.ts", cwd)]);
  await render(cwd);
  await act(async () =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === "Files")!.click(),
  );
  await typeQuery("needle");
  expect(index.load).toHaveBeenCalledWith(cwd);
  expect(index.search).toHaveBeenLastCalledWith(true, cwd, "needle");
  expect(host.textContent).toContain("needle.ts");
});

it("shows remote filename-read failure and retries its listing", async () => {
  const cwd = "remote://environment/repo";
  index.load
    .mockRejectedValueOnce(new Error("Owning computer disconnected"))
    .mockResolvedValueOnce([file("needle.ts", cwd)]);
  await render(cwd);
  await typeQuery("needle");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Owning computer disconnected",
  );
  await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("needle.ts");
});
it("refreshes created, renamed and deleted filename results without losing query or focus", async () => {
  index.files.set("/repo", [file("needle.ts")]);
  await render();
  await typeQuery("needle");
  const input = host.querySelector("input")!;
  expect(host.textContent).toContain("needle.ts");
  for (const files of [[file("needle-new.ts")], [file("needle-renamed.ts")], []]) {
    await act(async () => {
      index.files.set("/repo", files);
      notifyIndex();
    });
    expect(host.textContent).not.toContain("needle.ts");
    if (files.length) expect(host.textContent).toContain(files[0].name);
    else expect(host.textContent).not.toContain("needle-renamed.ts");
    expect(input.value).toBe("needle");
    expect(document.activeElement).toBe(input);
  }
  await render("/repo", false);
  expect(index.listeners.size).toBe(0);
});

it("ignores obsolete index loads after notifications and project changes", async () => {
  const pending: Array<(files: ProjectFile[]) => void> = [];
  index.load.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  await render();
  await typeQuery("needle");
  await act(async () => {
    index.files.set("/repo", [file("needle-current.ts")]);
    notifyIndex();
    pending[0]([file("needle-old.ts")]);
  });
  expect(host.textContent).toContain("needle-current.ts");
  expect(host.textContent).not.toContain("needle-old.ts");
  await act(async () => {
    index.files.delete("/repo");
    notifyIndex();
  });
  await render("/other");
  await typeQuery("needle");
  await act(async () => pending[1]([file("needle-wrong-project.ts")]));
  expect(host.textContent).not.toContain("needle-wrong-project.ts");
  await act(async () => pending[2]([file("needle-other.ts", "/other")]));
  expect(host.textContent).toContain("needle-other.ts");
  expect(index.listeners.size).toBe(1);
});
it("retains workspace search text and category across close/reopen and remount with project isolation", async () => {
  await render();
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "needle",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Projects")!
      .click();
  });
  await render("/repo", false);
  await render();
  expect(host.querySelector("input")!.value).toBe("needle");
  expect(
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Projects")!
      .getAttribute("aria-checked"),
  ).toBe("true");
  act(() => root.unmount());
  root = createRoot(host);
  await render();
  expect(host.querySelector("input")!.value).toBe("needle");
  await render("/other");
  expect(host.querySelector("input")!.value).toBe("");
  await render();
  expect(host.querySelector("input")!.value).toBe("needle");
});

it("opens a modal over the workspace, focuses search and closes through Escape", async () => {
  const onClose = vi.fn();
  await render("/repo", true, { presentation: "dialog", onClose });
  const dialog = document.body.querySelector('[role="dialog"]')!;
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.querySelector("[data-app-search]")).not.toBeNull();
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(document.activeElement).toBe(dialog.querySelector("input"));
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps the query and category when expanding into the page", async () => {
  const onExpand = vi.fn();
  await render("/repo", true, { presentation: "dialog", onExpand });
  await act(async () => {
    const input = document.body.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "project",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent === "Projects")!
      .click();
  });
  act(() => document.body.querySelector<HTMLButtonElement>('[aria-label="Full screen"]')!.click());
  expect(onExpand).toHaveBeenCalledTimes(1);
  await render("/repo", true, { presentation: "page", focusToken: 1 });
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector("input")!.value).toBe("project");
  expect(
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Projects")!
      .getAttribute("aria-checked"),
  ).toBe("true");
});

it("dismisses the filters before the search dialog with Escape", async () => {
  const onClose = vi.fn();
  await render("/repo", true, { presentation: "dialog", onClose });
  act(() =>
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent === "Conversations")!
      .click(),
  );
  act(() =>
    document.body.querySelector<HTMLButtonElement>('[aria-label="Chat search filters"]')!.click(),
  );
  expect(
    document.body.querySelector('[role="group"][aria-label="Chat search filters"]'),
  ).not.toBeNull();
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(
    document.body.querySelector('[role="group"][aria-label="Chat search filters"]'),
  ).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps file index failures scoped to All and Files", async () => {
  index.load.mockRejectedValue(new Error("File index offline"));
  await render();
  await typeQuery("needle");
  expect(host.textContent).toContain("File index offline");
  for (const scope of ["Projects", "Conversations", "Files", "All"]) {
    await act(async () =>
      [...host.querySelectorAll("button")].find((node) => node.textContent === scope)!.click(),
    );
    if (scope === "Projects" || scope === "Conversations")
      expect(host.textContent).not.toContain("File index offline");
    else expect(host.textContent).toContain("File index offline");
  }
});

it("opens contextual conversation search then broadens in the same surface without losing text", async () => {
  const request = {
    scope: "conversations" as const,
    conversationScope: "project" as const,
    query: "needle",
  };
  await render("/repo", true, { request });
  expect(host.querySelector("input")!.value).toBe("needle");
  const filters = host.querySelector<HTMLButtonElement>('[aria-label="Chat search filters"]')!;
  expect(filters.textContent).toContain("This project");
  act(() => filters.click());
  const scopeSelect = document.body.querySelector<HTMLSelectElement>(
    'select[aria-label="Search in"]',
  )!;
  expect(scopeSelect.value).toBe("project");
  act(() => {
    scopeSelect.value = "everywhere";
    scopeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(filters.textContent).toContain("Everywhere");
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  act(() =>
    [...host.querySelectorAll("button")].find((node) => node.textContent === "All")!.click(),
  );
  await render("/repo", true, { request, focusToken: 1 });
  expect(host.querySelector("input")!.value).toBe("needle");
  expect(
    [...host.querySelectorAll("button")]
      .find((node) => node.textContent === "All")!
      .getAttribute("aria-checked"),
  ).toBe("true");
  act(() =>
    [...host.querySelectorAll("button")]
      .find((node) => node.textContent === "Conversations")!
      .click(),
  );
  expect(filters.textContent).toContain("Everywhere");
});

it("retains shared search text when a contextual entry omits a query", async () => {
  await render();
  await typeQuery("draft");
  await render("/repo", true, {
    request: { scope: "conversations", conversationScope: "project" },
  });
  expect(host.querySelector("input")!.value).toBe("draft");
});
