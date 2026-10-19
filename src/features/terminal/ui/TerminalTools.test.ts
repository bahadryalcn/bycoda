// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Terminal } from "@xterm/xterm";
import { afterEach, expect, it, vi } from "vitest";
import { TerminalTools } from "./TerminalTools";

afterEach(() => vi.unstubAllGlobals());

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
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Review startup scripts"]')!;
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
    const help = host.querySelector<HTMLButtonElement>('[aria-label="About shell suggestions"]')!;
    expect(help.getAttribute("aria-expanded")).toBe("false");
    await act(async () => help.click());
    expect(document.body.textContent).toContain("-NoProfile");
    await act(async () => help.click());
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Shell suggestions"]')!.click(),
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

async function setup(options: { suggestionsAllowed?: boolean; alternate?: boolean } = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const paste = vi.fn();
  const focus = vi.fn();
  const mode = vi.fn();
  const terminal = {
    paste,
    focus,
    buffer: {
      active: { type: options.alternate ? "alternate" : "normal" },
      onBufferChange: () => ({ dispose() {} }),
    },
  } as unknown as Terminal;
  await act(async () =>
    root.render(
      createElement(TerminalTools, {
        terminal,
        mode: "command",
        onModeChange: mode,
        ready: true,
        suggestionsAllowed: options.suggestionsAllowed,
      }),
    ),
  );
  return {
    host,
    paste,
    focus,
    mode,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("makes suggestion navigation explicit and inserts text without command submission", async () => {
  const context = await setup();
  try {
    const field = context.host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    await act(async () =>
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    );
    expect(context.host.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe(
      "git diff",
    );
    await act(async () =>
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })),
    );
    expect(field.value).toBe("git diff");
    expect(context.paste).not.toHaveBeenCalled();
    await act(async () =>
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(context.paste).toHaveBeenCalledExactlyOnceWith("git diff");
    expect(context.mode).toHaveBeenCalledWith(null);
    expect(context.focus).toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});

it("Escape exits selection mode without inserting anything", async () => {
  const context = await setup();
  try {
    await act(async () =>
      context.host
        .querySelector("input")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(context.mode).toHaveBeenCalledWith(null);
    expect(context.paste).not.toHaveBeenCalled();
    expect(context.focus).toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});

it("does not accept a composing IME Enter", async () => {
  const context = await setup();
  try {
    const field = context.host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    await act(async () =>
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })),
    );
    await act(async () =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
      ),
    );
    expect(context.paste).not.toHaveBeenCalled();
    expect(context.mode).not.toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});

it("suppresses assistance entirely when remote prompt safety is unverified", async () => {
  const context = await setup({ suggestionsAllowed: false });
  try {
    expect(context.host.querySelector('[role="combobox"]')).toBeNull();
    expect(context.host.querySelector('[aria-label="Command suggestions"]')).toBeNull();
    expect(context.paste).not.toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});

it("prevents insertion into an alternate-screen program", async () => {
  const context = await setup({ alternate: true });
  try {
    const field = context.host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    await act(async () =>
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })),
    );
    await act(async () =>
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(context.paste).not.toHaveBeenCalled();
  } finally {
    await context.cleanup();
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
    expect(host.querySelector("details")?.open).toBe(false);
    expect(host.textContent).toContain("Session only.");
    await act(async () => (host.querySelector('[role="switch"]') as HTMLButtonElement).click());
    expect(shell.setAutomatic).toHaveBeenCalledExactlyOnceWith(true);
    const paths = [...host.querySelectorAll('[role="radio"]')].find((item) =>
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
