// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalTools } from "./TerminalTools";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
async function openTools(host: HTMLElement) {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Terminal · More actions"]')!.click(),
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
    const button = document.querySelector<HTMLButtonElement>(
      '[aria-label="Review startup scripts"]',
    )!;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(review).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => finish());
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
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
    const help = document.querySelector<HTMLButtonElement>(
      '[aria-label="About shell suggestions"]',
    )!;
    expect(help.getAttribute("aria-expanded")).toBe("false");
    await act(async () => help.click());
    expect(document.body.textContent).toContain("-NoProfile");
    await act(async () => help.click());
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Shell suggestions"]')!.click(),
    );
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')].find(
      (element) => element.textContent?.includes("PowerShell suggestions"),
    )!;
    expect(option.textContent).toContain("PSReadLine 2.4+");
    await act(async () => option.click());
    expect(enable).toHaveBeenCalledExactlyOnceWith("powershell");
    expect(paste).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
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
    expect(host.querySelector('[aria-label="Terminal · More actions"]')).not.toBeNull();
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
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const shell = {
    state: undefined,
    waiting: false,
    error: "",
    automatic: false,
    source: "commands" as const,
    request: vi.fn(async () => {}),
    accept: vi.fn(async () => {}),
    dismiss: vi.fn(),
    invalidate: vi.fn(),
    notifyInput: vi.fn(),
    suspendAutomatic: vi.fn(),
    setAutomatic: vi.fn(),
    setSource: vi.fn(),
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
    const paths = [...document.querySelectorAll('[role="radio"]')].find((item) =>
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
