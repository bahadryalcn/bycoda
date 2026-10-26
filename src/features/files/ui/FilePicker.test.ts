// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { projectFiles, remoteFiles, loadProjectFiles, rankProjectFiles } = vi.hoisted(() => {
  const projectFiles = [
    {
      path: "/repo/src/App.tsx",
      relative: "src/App.tsx",
      name: "App.tsx",
    },
  ];
  const remoteFiles = [
    {
      path: "remote://env/home/me/repo/src/App.tsx",
      relative: "src/App.tsx",
      name: "App.tsx",
    },
  ];
  return {
    projectFiles,
    remoteFiles,
    loadProjectFiles: vi.fn((cwd: string) =>
      cwd.startsWith("remote://") ? Promise.resolve(remoteFiles) : new Promise(() => {}),
    ),
    rankProjectFiles: vi.fn((_files: unknown[], query: string) =>
      query.trim() && !query.toLowerCase().includes("app")
        ? []
        : (_files as typeof projectFiles).map((file) => ({
            ...file,
            score: 1,
            positions: [],
          })),
    ),
  };
});

vi.mock("../model/fileIndex", () => ({
  loadProjectFiles,
  peekProjectFiles: vi.fn((cwd: string) => (cwd.startsWith("remote://") ? null : projectFiles)),
  rankProjectFiles,
  recentOpenedFiles: vi.fn(() => []),
  rememberOpenedFile: vi.fn(),
}));

vi.mock("../../projects/model/recents", () => ({
  looksLikeProject: (path: string) => path !== "~",
  isRemoteProjectPath: (path: string) => path.startsWith("remote://"),
}));

import { FilePicker, reloadActionHint } from "./FilePicker";
import { Modal } from "../../../shared/ui/Modal";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderPicker(initialQuery = "") {
  const onOpenFile = vi.fn();
  const onRunAction = vi.fn();
  const onClose = vi.fn();
  act(() =>
    root.render(
      createElement(FilePicker, {
        open: true,
        cwd: "/repo",
        initialQuery,
        onOpenFile,
        onRunAction,
        onClose,
      }),
    ),
  );
  return { onOpenFile, onRunAction, onClose };
}

function inputText(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("reports a failed refresh without hiding cached files and retries without losing the query", async () => {
  loadProjectFiles.mockRejectedValueOnce(new Error("File index unavailable"));
  renderPicker();
  await act(async () => {});
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Go to File"]')!;
  inputText(field, "App");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("File index unavailable");
  expect(document.querySelector("[data-file-picker]")?.textContent).toContain("App.tsx");
  let finish!: (files: typeof projectFiles) => void;
  loadProjectFiles.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const retry = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  )!;
  retry.focus();
  await act(async () => retry.click());
  expect(retry.getAttribute("aria-busy")).toBe("true");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("File index unavailable");
  expect(document.activeElement).toBe(retry);
  expect(field.value).toBe("App");
  await act(async () => finish(projectFiles));
  expect(field.value).toBe("App");
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("does not open a file while Enter is committing IME text", () => {
  const { onOpenFile, onClose } = renderPicker();
  const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Go to File"]')!;
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(onOpenFile).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

function press(input: HTMLInputElement, key: string) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

it("kapanmış picker Escape dinlemez, açılınca yalnız en üst overlay iptal olur", () => {
  const onClose = vi.fn();
  const childClose = vi.fn();
  const picker = (open: boolean) =>
    createElement(FilePicker, {
      open,
      cwd: "/repo",
      onOpenFile: vi.fn(),
      onRunAction: vi.fn(),
      onClose,
    });
  act(() => root.render(picker(false)));
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(onClose).not.toHaveBeenCalled();
  act(() => root.render(picker(true)));
  act(() =>
    root.render(
      createElement(
        "div",
        null,
        picker(true),
        createElement(Modal, { title: "Child", onClose: childClose, children: "child" }),
      ),
    ),
  );
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(childClose).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  act(() => root.render(picker(true)));
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(onClose).toHaveBeenCalledTimes(1);
  act(() => root.render(picker(false)));
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(onClose).toHaveBeenCalledTimes(1);
  act(() => root.render(picker(true)));
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("picker kapanınca odağı açan düğmeye geri verir", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const picker = (open: boolean) =>
    createElement(FilePicker, {
      open,
      cwd: "/repo",
      onOpenFile: vi.fn(),
      onRunAction: vi.fn(),
      onClose: vi.fn(),
    });
  try {
    act(() => root.render(picker(true)));
    expect(document.activeElement).not.toBe(trigger);
    act(() => root.render(picker(false)));
    expect(document.activeElement).toBe(trigger);
  } finally {
    trigger.remove();
  }
});

describe("file picker command mode", () => {
  it("formats reload shortcut hints for macOS and non-macOS", () => {
    expect(reloadActionHint("⌘", "⇧")).toBe("⌘⇧R");
    expect(reloadActionHint("Ctrl+", "Shift+")).toBe("Ctrl+Shift+R");
  });
  it("opens from an initial > query without ranking project files", () => {
    renderPicker(">");

    const dialog = document.querySelector<HTMLElement>("[data-file-picker]")!;
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    expect(dialog.getAttribute("aria-label")).toBe("Command Palette");
    expect(input.value).toBe(">");
    expect(input.placeholder).toContain("type > for commands");
    expect(dialog.querySelector('[role="listbox"][aria-label="Commands"]')).not.toBeNull();
    expect(dialog.textContent).toContain("Reload bycoda");
    expect(dialog.textContent).toContain(reloadActionHint());
    expect(rankProjectFiles).not.toHaveBeenCalled();
  });

  it("only treats a leading > as command mode and reverts when it is deleted", () => {
    renderPicker();
    const dialog = document.querySelector<HTMLElement>("[data-file-picker]")!;
    const input = dialog.querySelector<HTMLInputElement>("input")!;

    inputText(input, "App>");
    expect(dialog.getAttribute("aria-label")).toBe("Go to File");
    expect(dialog.querySelector('[role="listbox"][aria-label="Files"]')).not.toBeNull();

    rankProjectFiles.mockClear();
    inputText(input, ">");
    expect(dialog.getAttribute("aria-label")).toBe("Command Palette");
    expect(dialog.textContent).toContain("Reload bycoda");
    expect(rankProjectFiles).not.toHaveBeenCalled();

    inputText(input, "App");
    expect(dialog.getAttribute("aria-label")).toBe("Go to File");
    expect(dialog.querySelector('[role="listbox"][aria-label="Files"]')).not.toBeNull();
    expect(rankProjectFiles).toHaveBeenCalled();
  });

  it("fuzzy-filters and highlights commands with palette-specific empty copy", () => {
    renderPicker(">");
    const dialog = document.querySelector<HTMLElement>("[data-file-picker]")!;
    const input = dialog.querySelector<HTMLInputElement>("input")!;

    inputText(input, "> rbd");
    const reload = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Reload bycoda"),
    )!;
    expect(reload).not.toBeUndefined();
    expect(reload.querySelectorAll(".text-accent")).toHaveLength(3);

    inputText(input, "> missing");
    expect(dialog.textContent).toContain("No matching commands");
    expect(dialog.textContent).not.toContain("No matching files");
  });

  it.each(["click", "Enter"] as const)("runs the selected command and closes on %s", (method) => {
    const callbacks = renderPicker(">");
    const dialog = document.querySelector<HTMLElement>("[data-file-picker]")!;
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    const reload = dialog.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="true"]',
    )!;

    if (method === "click") act(() => reload.click());
    else press(input, "Enter");

    expect(callbacks.onRunAction).toHaveBeenCalledExactlyOnceWith("reload");
    expect(callbacks.onClose).toHaveBeenCalledOnce();
    expect(callbacks.onOpenFile).not.toHaveBeenCalled();
  });
});

describe("file picker on a remote project", () => {
  const cwd = "remote://env/home/me/repo";

  it("uses the shared file list and opens its remote path", async () => {
    const onOpenFile = vi.fn();
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        createElement(FilePicker, {
          open: true,
          cwd,
          initialQuery: "app",
          onOpenFile,
          onRunAction: vi.fn(),
          onClose,
        }),
      ),
    );
    const dialog = document.querySelector<HTMLElement>("[data-file-picker]")!;
    expect(loadProjectFiles).toHaveBeenCalledWith(cwd, true);
    expect(dialog.textContent).toContain("App.tsx");

    press(dialog.querySelector<HTMLInputElement>("input")!, "Enter");
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(remoteFiles[0].path, undefined, {
      exact: true,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a connection error from the shared file list", async () => {
    loadProjectFiles.mockRejectedValueOnce(new Error("Machine is not connected"));
    await act(async () =>
      root.render(
        createElement(FilePicker, {
          open: true,
          cwd,
          onOpenFile: vi.fn(),
          onRunAction: vi.fn(),
          onClose: vi.fn(),
        }),
      ),
    );
    expect(document.body.textContent).toContain("Machine is not connected");
  });
});

it("keeps file result IDs connected to the focused search through navigation and empty filtering", async () => {
  loadProjectFiles.mockResolvedValueOnce([
    ...projectFiles,
    { path: "/repo/src/Beta.tsx", relative: "src/Beta.tsx", name: "Beta.tsx" },
  ]);
  const { onOpenFile } = renderPicker();
  await act(async () => {});
  const field = document.querySelector<HTMLInputElement>(
    '[role="combobox"][aria-label="Go to File"]',
  )!;
  field.focus();
  const list = document.getElementById(field.getAttribute("aria-controls")!)!;
  expect(list.getAttribute("role")).toBe("listbox");
  expect(
    document.getElementById(field.getAttribute("aria-activedescendant")!)?.textContent,
  ).toContain("App.tsx");
  act(() =>
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(field);
  const active = document.getElementById(field.getAttribute("aria-activedescendant")!)!;
  expect(active.textContent).toContain("Beta.tsx");
  expect(active.getAttribute("aria-selected")).toBe("true");
  expect(active.tabIndex).toBe(-1);
  act(() =>
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
  expect(onOpenFile).toHaveBeenCalledWith("/repo/src/Beta.tsx", undefined, { exact: true });
  inputText(field, "no-result");
  expect(field.hasAttribute("aria-activedescendant")).toBe(false);
  expect(field.hasAttribute("aria-controls")).toBe(false);
  expect(field.getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector('[role="status"]')?.textContent).toContain("No matching files");
});

it("connects command results to the same search composite without a stale active ID", () => {
  renderPicker(">");
  const field = document.querySelector<HTMLInputElement>(
    '[role="combobox"][aria-label="Command Palette"]',
  )!;
  const list = document.getElementById(field.getAttribute("aria-controls")!)!;
  expect(list.getAttribute("aria-label")).toBe("Commands");
  expect(
    document.getElementById(field.getAttribute("aria-activedescendant")!)?.textContent,
  ).toContain("Reload");
  inputText(field, ">no-such-command-xyz");
  expect(field.hasAttribute("aria-activedescendant")).toBe(false);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("No matching commands");
});

it("keeps long diagnostics readable behind a disclosure without hiding recovery or cached files", async () => {
  const diagnostic = "Remote listing failed: " + "Detailed transport information. ".repeat(30);
  loadProjectFiles.mockRejectedValueOnce(new Error(diagnostic));
  renderPicker();
  await act(async () => {});
  const details = document.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.querySelector('summary [role="alert"]')?.textContent).toContain(
    "Remote listing failed:",
  );
  expect(details.querySelector("p")?.textContent).toBe(diagnostic);
  expect(details.querySelector("p")?.tabIndex).toBe(0);
  expect(document.querySelector("[data-file-picker]")?.textContent).toContain("App.tsx");
  expect(
    [...document.querySelectorAll("button")].some((button) => button.textContent === "Retry"),
  ).toBe(true);
});
