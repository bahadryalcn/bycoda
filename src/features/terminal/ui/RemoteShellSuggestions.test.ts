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
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const shell: SshShellController = {
    state: {
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
    },
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
    focus: vi.fn(),
    input: vi.fn(),
    buffer: { active: { type: alternate ? "alternate" : "normal" } },
  } as unknown as Terminal;
  const close = vi.fn();
  await act(async () =>
    root.render(
      createElement(RemoteShellSuggestions, { shell, terminal, onClose: close, selectionMode }),
    ),
  );
  const key = async (key: string, extra: KeyboardEventInit = {}) =>
    act(async () =>
      host
        .querySelector('[aria-label="Remote suggestion selection"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }),
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

it("passive preview never focuses or intercepts shell keys and still inserts only on explicit click", async () => {
  const context = await setup(false, false, "bash", false);
  try {
    const preview = context.host.querySelector('[aria-label="Remote suggestion preview"]')!;
    expect(document.activeElement).not.toBe(preview);
    expect(preview.hasAttribute("tabindex")).toBe(false);
    expect(preview.textContent).toContain("Shell keys stay in the terminal.");
    expect(preview.textContent).not.toContain("↑/↓ select");
    for (const key of ["ArrowUp", "ArrowDown", "Tab", "Enter", "Escape", "r"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        ctrlKey: key === "r",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => preview.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    expect(context.shell.accept).not.toHaveBeenCalled();
    await act(async () => (context.host.querySelector('[role="option"]') as HTMLElement).click());
    expect(context.shell.accept).toHaveBeenCalledWith("git status");
    expect(context.terminal.input).not.toHaveBeenCalled();
  } finally {
    await context.cleanup();
  }
});
