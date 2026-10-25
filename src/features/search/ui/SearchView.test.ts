// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchView } from "./SearchView";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import type { ProjectFile } from "../../../platform/tauri/fs";

const index = vi.hoisted(() => ({
  files: new Map<string, ProjectFile[]>(),
  listeners: new Set<() => void>(),
  load: vi.fn<(cwd: string) => Promise<ProjectFile[]>>(),
  search: vi.fn(),
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
    result: { sessions: [], pending: 0, truncated: false },
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
vi.mock("../../group-lock/hooks/useGroupLock", () => ({ useLockSnapshot: () => ({}) }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  index.files.clear();
  index.listeners.clear();
  index.load.mockReset().mockImplementation(async (cwd) => index.files.get(cwd) ?? []);
  index.search.mockClear();
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
