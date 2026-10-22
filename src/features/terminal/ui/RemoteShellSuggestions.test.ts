// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Terminal } from "@xterm/xterm";
import { afterEach, expect, it, vi } from "vitest";
import { RemoteShellSuggestions } from "./RemoteShellSuggestions";
import type { SshShellController } from "../model/sshShellIntegration";
afterEach(() => vi.unstubAllGlobals());
async function setup(
  alternate = false,
  duplicates = false,
  shellMode: "bash" | "zsh" | "powershell" = "bash",
  selectionMode = true,
  preview?: SshShellController["preview"],
  live = true,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const shell: SshShellController = {
    state: live
      ? {
          id: "terminal",
          status: "suggestions",
          shell: shellMode,
          user: "remote-alice",
          host: "server-a",
          prefix: "git ",
          cursor: 4,
          requestId: "fresh",
          suggestions: duplicates
            ? ["git status", "git status", "git diff", "git status"]
            : ["git status", "git diff"],
        }
      : undefined,
    preview: undefined,
    waiting: false,
    error: "",
    request: vi.fn(async () => {}),
    dismiss: vi.fn(),
    accept: vi.fn(async () => {}),
    invalidate: vi.fn(),
    automatic: false,
    source: "commands",
    setAutomatic: vi.fn(),
    setSource: vi.fn(),
    notifyInput: vi.fn(),
    suspendAutomatic: vi.fn(),
  };
  const terminal = {
    element: document.createElement("div"),
    focus: vi.fn(),
    input: vi.fn(),
    buffer: { active: { type: alternate ? "alternate" : "normal" } },
  } as unknown as Terminal;
  const close = vi.fn();
  await act(async () =>
    root.render(
      createElement(RemoteShellSuggestions, {
        shell,
        terminal,
        onClose: close,
        selectionMode,
        preview,
      }),
    ),
  );
  const key = async (key: string, extra: KeyboardEventInit = {}) =>
    act(async () =>
      host.querySelector('[aria-label="Remote suggestion selection"]')!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...extra,
        }),
      ),
    );
  return {
    host,
    shell,
    terminal,
    close,
    key,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
it("shows actual remote scope and prefix, selects explicitly and accepts without sending Enter", async () => {
  const context = await setup();
  try {
    expect(context.host.textContent).toContain("remote-alice@server-a");
    expect(context.host.textContent).toContain("git ");
    await context.key("ArrowDown");
    await context.key("Tab");
    expect(context.shell.accept).toHaveBeenCalledExactlyOnceWith("git diff");
    expect(context.terminal.input).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});
it("labels PowerShell native events and preserves insert-only acceptance", async () => {
  const context = await setup(false, false, "powershell");
  try {
    expect(context.host.textContent).toContain("remote-alice@server-a · PowerShell");
    expect(context.shell.accept).not.toHaveBeenCalled();
    await context.key("Enter");
    expect(context.shell.accept).toHaveBeenCalledExactlyOnceWith("git status");
    expect(context.terminal.input).not.toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});
it("deduplicates history candidates while preserving order and keyboard selection", async () => {
  const context = await setup(false, true);
  try {
    expect(
      Array.from(context.host.querySelectorAll('[role="option"]')).map(
        (element) => element.textContent,
      ),
    ).toEqual(["git status", "git diff"]);
    await context.key("ArrowDown");
    expect(context.host.querySelector('[aria-selected="true"]')?.textContent).toBe("git diff");
    await context.key("Enter");
    expect(context.shell.accept).toHaveBeenCalledExactlyOnceWith("git diff");
    expect(context.terminal.input).not.toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});
it("Escape leaves suggestion mode and composing Enter never accepts", async () => {
  const context = await setup();
  try {
    await context.key("Enter", { isComposing: true });
    expect(context.shell.accept).not.toHaveBeenCalled();
    await context.key("Escape");
    expect(context.shell.dismiss).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
    expect(context.terminal.focus).toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});
it("refuses acceptance in a full-screen alternate buffer and keeps Ctrl+C interrupt explicit", async () => {
  const context = await setup(true);
  try {
    await context.key("Enter");
    expect(context.shell.accept).not.toHaveBeenCalled();
    await context.key("c", { ctrlKey: true });
    expect(context.terminal.input).toHaveBeenCalledExactlyOnceWith("\x03");
    expect(context.close).toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});

it("automatic preview preserves typing, history and Enter while accepting only explicit completion", async () => {
  const context = await setup(false, false, "bash", false);
  try {
    const preview = context.host.querySelector('[aria-label="Remote suggestion preview"]')!;
    expect(document.activeElement).not.toBe(preview);
    const element = context.terminal.element!;
    const key = async (value: string, extra: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      await act(async () => element.dispatchEvent(event));
      return event;
    };
    expect((await key("g")).defaultPrevented).toBe(false);
    expect((await key("Enter", { isComposing: true })).defaultPrevented).toBe(false);
    for (const value of ["ArrowDown", "ArrowUp", "ArrowLeft", "Enter", "Tab"]) {
      const extra = value === "Tab" ? { shiftKey: true } : {};
      expect((await key(value, extra)).defaultPrevented).toBe(false);
    }
    expect(context.shell.accept).not.toHaveBeenCalled();
    expect(context.host.querySelector('[aria-selected="true"]')?.textContent).toBe("git status");
    await key("Tab");
    expect(context.shell.accept).toHaveBeenCalledExactlyOnceWith("git status");
    expect(context.terminal.input).not.toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});

it("browses the automatic list with Alt arrows without taking shell history keys", async () => {
  const context = await setup(false, false, "bash", false);
  try {
    await act(async () =>
      context.terminal.element!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(context.host.querySelector('[aria-selected="true"]')?.textContent).toBe("git diff");
    await act(async () =>
      context.terminal.element!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(context.shell.accept).toHaveBeenCalledExactlyOnceWith("git diff");
    expect(context.terminal.input).not.toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});

it("keeps a retained passive list on screen without taking completion keys", async () => {
  const preview = { prefix: "git s", suggestions: ["git status", "git stash"] };
  const context = await setup(false, false, "bash", false, preview, false);
  try {
    const options = [...context.host.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(["git status", "git stash"]);
    expect(context.host.textContent).not.toContain("Waiting for the shell prompt");
    for (const value of ["Tab", "ArrowRight"]) {
      const event = new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => context.terminal.element!.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    await act(async () => (options[0] as HTMLElement).click());
    expect(context.shell.accept).not.toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});
