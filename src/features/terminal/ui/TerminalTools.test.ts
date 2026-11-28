// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalTools } from "./TerminalTools";
import { RemoteShellSuggestionsOverlay } from "./RemoteShellSuggestionsOverlay";
import { catalogSuggestions, type SshShellController } from "../model/sshShellIntegration";

vi.mock("./TerminalCursorPopover", () => ({
  TerminalCursorPopover: ({ children }: { children: React.ReactNode }) =>
    createElement("div", { "data-cursor-popover": true }, children),
}));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it("shows the effective terminal size and resets only through its owner callback", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const reset = vi.fn();
  const terminal = {
    focus: vi.fn(),
    input: vi.fn(),
    paste: vi.fn(),
    buffer: { active: { type: "normal" }, onBufferChange: () => ({ dispose() {} }) },
  } as unknown as Terminal;
  try {
    await act(async () =>
      root.render(
        createElement(TerminalTools, {
          terminal,
          ready: true,
          mode: null,
          onModeChange: vi.fn(),
          fontSize: 19,
          savedFontSize: 13,
          onResetFontSize: reset,
        }),
      ),
    );
    await openTools(host);
    expect(
      document
        .querySelector('[aria-label="Terminal font size"] [role="status"]')
        ?.textContent?.trim(),
    ).toBe("19px");
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Reset text size",
    )!;
    await act(async () => button.click());
    expect(reset).toHaveBeenCalledOnce();
    expect(terminal.input).not.toHaveBeenCalled();
    expect(terminal.paste).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

async function openTools(host: HTMLElement) {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Terminal pane actions"]')!.click(),
  );
}

it("requests a startup review explicitly without writing terminal input and blocks duplicate pending requests", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host);
  let finish!: () => void;
  const review = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const paste = vi.fn(),
    input = vi.fn();
  const terminal = {
    paste,
    input,
    buffer: { active: { type: "normal" }, onBufferChange: () => ({ dispose() {} }) },
  } as unknown as Terminal;
  try {
    await act(async () =>
      root.render(
        createElement(TerminalTools, {
          terminal,
          ready: true,
          mode: null,
          onModeChange: vi.fn(),
          suggestionsAllowed: false,
          onStartupReview: review,
        }),
      ),
    );
    expect(review).not.toHaveBeenCalled();
    await openTools(host);
    const startupItem = () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (node) => node.textContent === "Review startup scripts",
      )!;
    await act(async () => startupItem().click());
    expect(review).toHaveBeenCalledTimes(1);
    await openTools(host);
    expect(startupItem().disabled).toBe(true);
    await act(async () => startupItem().click());
    expect(review).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(startupItem().disabled).toBe(false);
    expect(paste).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

it("opens PowerShell suggestions only from an explicit alternative without terminal input", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    enable = vi.fn(),
    paste = vi.fn(),
    input = vi.fn();
  const terminal = {
    paste,
    input,
    buffer: { active: { type: "normal" }, onBufferChange: () => ({ dispose() {} }) },
  } as unknown as Terminal;
  try {
    await act(async () =>
      root.render(
        createElement(TerminalTools, {
          terminal,
          mode: null,
          onModeChange: vi.fn(),
          ready: true,
          suggestionsAllowed: false,
          onEnableShellIntegration: enable,
        }),
      ),
    );
    expect(enable).not.toHaveBeenCalled();
    await openTools(host);
    const menuItem = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')].find((element) =>
        element.textContent?.includes(label),
      )!;
    await act(async () => menuItem("About shell suggestions").click());
    expect(document.body.textContent).toContain("PSReadLine 2.4+");
    await openTools(host);
    const option = menuItem("PowerShell suggestions");
    await act(async () => option.click());
    expect(enable).toHaveBeenCalledExactlyOnceWith("powershell");
    expect(paste).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("can save and manage commands from a saved SSH header before the terminal is ready", async () => {
  const host = document.createElement("div");
  const toolbarTarget = document.createElement("div");
  document.body.append(host, toolbarTarget);
  const root = createRoot(host);
  const save = vi.fn();
  const manage = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(TerminalTools, {
          terminal: null,
          mode: null,
          ready: false,
          onModeChange: vi.fn(),
          onSaveCommand: save,
          onSavedCommands: manage,
          toolbarTarget,
        }),
      ),
    );
    const saveButton = Array.from(toolbarTarget.querySelectorAll("button")).find(
      (button) => button.textContent === "Save command",
    );
    await act(async () => saveButton!.click());
    expect(save).toHaveBeenCalledOnce();
    await openTools(toolbarTarget);
    const manager = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Saved commands",
    );
    expect(document.body.textContent).not.toContain("Clear terminal");
    await act(async () => manager!.click());
    expect(manage).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    toolbarTarget.remove();
  }
});

it("opens search directly and offers local view actions without writing shell input", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onModeChange = vi.fn();
  const terminal = {
    clear: vi.fn(),
    scrollToBottom: vi.fn(),
    focus: vi.fn(),
    input: vi.fn(),
    buffer: { active: { type: "normal" }, onBufferChange: () => ({ dispose() {} }) },
  } as unknown as Terminal;
  try {
    await act(async () =>
      root.render(
        createElement(TerminalTools, {
          terminal,
          mode: null,
          ready: true,
          onModeChange,
        }),
      ),
    );
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector("[data-terminal-tools]")).toBeNull();
    expect(host.querySelector('[aria-label="Terminal pane actions"]')).not.toBeNull();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Find in terminal"]')!.click(),
    );
    expect(onModeChange).toHaveBeenCalledExactlyOnceWith("search");
    await openTools(host);
    const clear = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Clear terminal",
    )!;
    await act(async () => clear.click());
    expect(terminal.clear).toHaveBeenCalledOnce();
    await openTools(host);
    const bottom = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Scroll to bottom",
    )!;
    await act(async () => bottom.click());
    expect(terminal.scrollToBottom).toHaveBeenCalledOnce();
    expect(terminal.input).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("keeps automatic exposure and source choices explicit without requesting on mount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const shell = {
    state: undefined,
    waiting: false,
    notice: "",
    noticeDetails: undefined,
    automatic: false,
    source: "commands" as const,
    request: vi.fn(async () => {}),
    accept: vi.fn(async () => {}),
    dismiss: vi.fn(),
    invalidate: vi.fn(),
    suspendAutomatic: vi.fn(),
    setAutomatic: vi.fn(),
    setSource: vi.fn(),
    promptReady: true,
    previewEpoch: 0,
    catalogMatches: vi.fn(() => []),
    catalogSelection: vi.fn(() => undefined),
    selectFromCatalog: vi.fn(() => false),
    acceptCatalog: vi.fn(async () => {}),
  };
  const terminal = {
    focus: vi.fn(),
    buffer: { active: { type: "normal" }, onBufferChange: () => ({ dispose() {} }) },
  } as unknown as Terminal;
  try {
    await act(async () =>
      root.render(
        createElement(TerminalTools, {
          terminal,
          mode: null,
          onModeChange: vi.fn(),
          ready: true,
          remoteShell: shell,
        }),
      ),
    );
    expect(shell.request).not.toHaveBeenCalled();
    await openTools(host);
    expect(document.querySelector("details")?.open).toBe(false);
    expect(document.body.textContent).toContain("Session only.");
    await act(async () => (document.querySelector('[role="switch"]') as HTMLButtonElement).click());
    expect(shell.setAutomatic).toHaveBeenCalledExactlyOnceWith(true);
    const source = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Suggestion source: Commands"]',
    )!;
    await act(async () => source.click());
    const paths = [...document.querySelectorAll('[role="option"]')].find((item) =>
      item.textContent?.includes("Remote paths"),
    ) as HTMLButtonElement;
    await act(async () => paths.click());
    expect(shell.setSource).toHaveBeenCalledExactlyOnceWith("paths");
    expect(shell.request).not.toHaveBeenCalled();
    expect(terminal.focus).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("updates only the floating list from the prompt catalog while the owner types", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let line = "$ ";
  const disposable = { dispose() {} };
  const parsed: (() => void)[] = [];
  const typed: ((data: string) => void)[] = [];
  const terminal = {
    element: document.createElement("div"),
    focus: vi.fn(),
    onWriteParsed: (listener: () => void) => {
      parsed.push(listener);
      return disposable;
    },
    onData: (listener: (data: string) => void) => {
      typed.push(listener);
      return disposable;
    },
    hasSelection: () => false,
    buffer: {
      onBufferChange: () => disposable,
      active: {
        type: "normal",
        baseY: 0,
        viewportY: 0,
        cursorY: 0,
        get cursorX() {
          return line.length;
        },
        getLine: () => ({
          isWrapped: false,
          translateToString: (trim: boolean, start = 0, end = line.length) => {
            const value = line.slice(start, end);
            return trim ? value.trimEnd() : value;
          },
        }),
      },
    },
  } as unknown as Terminal;
  const catalog = { history: ["git stash list", "git status"], commands: ["git", "gitk"] };
  const shell = {
    state: undefined,
    waiting: false,
    notice: "",
    noticeDetails: undefined,
    automatic: true,
    source: "commands",
    request: vi.fn(async () => {}),
    accept: vi.fn(async () => {}),
    dismiss: vi.fn(),
    invalidate: vi.fn(),
    suspendAutomatic: vi.fn(),
    setAutomatic: vi.fn(),
    setSource: vi.fn(),
    promptReady: true,
    previewEpoch: 0,
    catalogMatches: (prefix: string) => catalogSuggestions(catalog, "commands", prefix),
    catalogSelection: () => undefined,
    selectFromCatalog: () => false,
    acceptCatalog: vi.fn(async () => {}),
  } as SshShellController;
  const render = (remoteShell: SshShellController) =>
    act(async () =>
      root.render(
        createElement(RemoteShellSuggestionsOverlay, {
          terminal,
          selectionMode: false,
          onClose: vi.fn(),
          shell: remoteShell,
        }),
      ),
    );
  const type = async (next: string) => {
    await act(async () => typed.forEach((listener) => listener(next.slice(-1))));
    line = `$ ${next}`;
    await act(async () => parsed.forEach((listener) => listener()));
  };
  const options = () =>
    [...host.querySelectorAll('[role="option"]')].map((option) => option.textContent);
  try {
    await render(shell);
    // Nothing is shown before the owner types at this prompt.
    expect(host.querySelector("[data-cursor-popover]")).toBeNull();
    await type("git s");
    const popover = host.querySelector("[data-cursor-popover]");
    expect(popover).not.toBeNull();
    expect(options()).toEqual(["git stash list", "git status"]);
    await type("git sta");
    expect(host.querySelector("[data-cursor-popover]")).toBe(popover);
    expect(options()).toEqual(["git stash list", "git status"]);
    await type("git stat");
    expect(host.querySelector("[data-cursor-popover]")).toBe(popover);
    expect(options()).toEqual(["git status"]);
    // Lookups never reach the shell: no snapshot request and no insertion while typing.
    expect(shell.request).not.toHaveBeenCalled();
    expect(shell.acceptCatalog).not.toHaveBeenCalled();
    // A dismissal keeps the list closed until the next typed edit.
    await render({ ...shell, previewEpoch: 1 });
    expect(host.querySelector("[data-cursor-popover]")).toBeNull();
    await type("git statu");
    expect(options()).toEqual(["git status"]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("steps the floating tools aside while typing and brings them back on pointer movement", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const terminal = {
    focus: vi.fn(),
    buffer: { active: { type: "normal" }, onBufferChange: () => ({ dispose() {} }) },
  } as unknown as Terminal;
  try {
    await act(async () =>
      root.render(
        createElement(TerminalTools, { terminal, ready: true, mode: null, onModeChange: vi.fn() }),
      ),
    );
    const overlay = host.firstElementChild as HTMLElement;
    const prompt = document.createElement("textarea");
    host.append(prompt);
    expect(overlay.hasAttribute("data-typing")).toBe(false);
    await act(async () => prompt.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true })));
    expect(overlay.hasAttribute("data-typing")).toBe(true);
    await act(async () => host.dispatchEvent(new Event("pointermove", { bubbles: true })));
    expect(overlay.hasAttribute("data-typing")).toBe(false);
    // Keys typed inside the tools themselves (e.g. the search field) never hide them.
    const button = overlay.querySelector("button")!;
    await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true })));
    expect(overlay.hasAttribute("data-typing")).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
