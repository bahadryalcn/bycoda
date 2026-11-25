// @vitest-environment happy-dom
import type { Terminal } from "@xterm/xterm";
import { afterEach, expect, it, vi } from "vitest";
import { bindTerminalDomInput } from "./terminalDomInput";

vi.mock("../../../platform/tauri/platform", () => ({ IS_MAC: true }));

afterEach(() => vi.restoreAllMocks());

function setupPaste() {
  const host = document.createElement("div");
  const textarea = document.createElement("textarea");
  host.append(textarea);
  document.body.append(host);
  const read = vi.spyOn(navigator.clipboard, "readText").mockResolvedValue("  first\nsecond  ");
  const paste = vi.fn();
  const term = {
    options: { disableStdin: false },
    modes: { mouseTrackingMode: "none" },
    focus: () => textarea.focus(),
    paste,
  };
  let handle!: (event: KeyboardEvent) => boolean;
  const binding = bindTerminalDomInput({
    term: {
      ...term,
      attachCustomKeyEventHandler: (listener: typeof handle) => {
        handle = listener;
      },
    } as unknown as Terminal,
    host,
    onCompositionStart() {},
    onCompositionEnd() {},
  });
  const shiftInsert = (init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key: "Insert",
      shiftKey: true,
      cancelable: true,
      ...init,
    });
    const passToTerminal = handle(event);
    return { event, passToTerminal };
  };
  const contextMenu = (init: MouseEventInit = {}) =>
    textarea.dispatchEvent(
      new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true, ...init }),
    );
  return {
    textarea,
    term,
    read,
    paste,
    shiftInsert,
    contextMenu,
    binding,
    cleanup() {
      binding.dispose();
      host.remove();
    },
  };
}

it("pastes clipboard text once on Shift+Insert and leaves IME, key repeats and other chords alone", async () => {
  const { textarea, read, paste, shiftInsert, cleanup } = setupPaste();
  try {
    textarea.focus();
    const { event, passToTerminal } = shiftInsert();
    expect(event.defaultPrevented).toBe(true);
    expect(passToTerminal).toBe(false);
    expect(shiftInsert({ repeat: true }).passToTerminal).toBe(false);
    expect(shiftInsert({ isComposing: true }).passToTerminal).toBe(true);
    expect(shiftInsert({ ctrlKey: true }).passToTerminal).toBe(true);
    await vi.waitFor(() => expect(paste).toHaveBeenCalledExactlyOnceWith("  first\nsecond  "));
    expect(read).toHaveBeenCalledOnce();
  } finally {
    cleanup();
  }
});

it("pastes on a plain right click and preserves mouse reporting and keyboard context menus", async () => {
  const { textarea, term, read, paste, contextMenu, cleanup } = setupPaste();
  try {
    expect(contextMenu({ button: 0 })).toBe(true);
    term.modes.mouseTrackingMode = "vt200";
    expect(contextMenu()).toBe(true);
    term.modes.mouseTrackingMode = "none";
    expect(contextMenu()).toBe(false);
    expect(document.activeElement).toBe(textarea);
    await vi.waitFor(() => expect(paste).toHaveBeenCalledExactlyOnceWith("  first\nsecond  "));
    expect(read).toHaveBeenCalledOnce();
  } finally {
    cleanup();
  }
});

it("drops a pending clipboard read after leaving the terminal or disposing its input binding", async () => {
  const { textarea, read, paste, shiftInsert, contextMenu, binding, cleanup } = setupPaste();
  try {
    let resolve!: (text: string) => void;
    read.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    contextMenu();
    textarea.blur();
    textarea.focus();
    resolve("old tab");
    await Promise.resolve();
    await Promise.resolve();
    expect(paste).not.toHaveBeenCalled();
    shiftInsert();
    binding.dispose();
    resolve("closed terminal");
    await Promise.resolve();
    await Promise.resolve();
    expect(paste).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
    expect(contextMenu()).toBe(true);
  } finally {
    cleanup();
  }
});

it("keeps disabled input and unavailable clipboard data out of the PTY", async () => {
  const { textarea, term, read, paste, shiftInsert, contextMenu, cleanup } = setupPaste();
  try {
    textarea.focus();
    term.options.disableStdin = true;
    shiftInsert();
    expect(contextMenu()).toBe(true);
    expect(read).not.toHaveBeenCalled();
    term.options.disableStdin = false;
    read.mockRejectedValueOnce(new Error("Permission denied")).mockResolvedValueOnce("");
    shiftInsert();
    await Promise.resolve();
    await Promise.resolve();
    contextMenu();
    await Promise.resolve();
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
    expect(paste).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

it("leaves composing macOS editing keys to xterm without injecting shortcuts", () => {
  let handle!: (event: KeyboardEvent) => boolean;
  const input = vi.fn();
  const clear = vi.fn();
  const term = {
    options: { macOptionIsMeta: false },
    input,
    clear,
    attachCustomKeyEventHandler: (listener: typeof handle) => {
      handle = listener;
    },
  } as unknown as Terminal;
  const binding = bindTerminalDomInput({
    term,
    host: document.createElement("div"),
    onCompositionStart() {},
    onCompositionEnd() {},
  });
  try {
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const shortcut of [
        { key: "ArrowLeft", altKey: true },
        { key: "k", metaKey: true },
      ]) {
        const event = new KeyboardEvent("keydown", {
          ...shortcut,
          ...composition,
          cancelable: true,
        });
        expect(handle(event)).toBe(true);
        expect(event.defaultPrevented).toBe(false);
      }
    }
    expect(input).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(handle(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true }))).toBe(false);
    expect(input).toHaveBeenCalledExactlyOnceWith("\x1bb");
  } finally {
    binding.dispose();
  }
});

it("enables xterm Meta per Option key and clears it for layout text and composition", () => {
  let handle!: (event: KeyboardEvent) => boolean;
  const options = { macOptionIsMeta: false };
  const term = {
    options,
    attachCustomKeyEventHandler: (listener: typeof handle) => {
      handle = listener;
    },
  } as unknown as Terminal;
  const binding = bindTerminalDomInput({
    term,
    host: document.createElement("div"),
    onCompositionStart() {},
    onCompositionEnd() {},
  });
  try {
    for (const [init, asMeta] of [
      [{ key: "b", code: "KeyB", keyCode: 66 }, true],
      [{ key: "@", code: "KeyQ", keyCode: 81 }, false],
      [{ key: "B", code: "KeyB", keyCode: 66, shiftKey: true }, true],
      [{ key: "{", code: "Digit7", keyCode: 55, shiftKey: true }, false],
      [{ key: "Enter", code: "Enter", keyCode: 13 }, true],
      [{ key: "Dead", code: "KeyU", keyCode: 85 }, false],
      [{ key: "f", code: "KeyF", keyCode: 70, ctrlKey: true }, true],
      [{ key: "b", code: "KeyB", keyCode: 66, isComposing: true }, false],
      [{ key: "b", code: "KeyB", keyCode: 66 }, true],
      [{ key: "b", code: "KeyB", keyCode: 66, altKey: false }, false],
    ] as const) {
      expect(handle(new KeyboardEvent("keydown", { altKey: true, ...init }))).toBe(true);
      expect(options.macOptionIsMeta, JSON.stringify(init)).toBe(asMeta);
    }
  } finally {
    binding.dispose();
  }
});
