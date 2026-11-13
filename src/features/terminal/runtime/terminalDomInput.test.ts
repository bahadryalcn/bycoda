// @vitest-environment happy-dom
import type { Terminal } from "@xterm/xterm";
import { expect, it, vi } from "vitest";
import { bindTerminalDomInput } from "./terminalDomInput";

vi.mock("../../../platform/tauri/platform", () => ({ IS_MAC: true }));

it("leaves composing macOS editing keys to xterm without injecting shortcuts", () => {
  let handle!: (event: KeyboardEvent) => boolean;
  const input = vi.fn();
  const clear = vi.fn();
  const term = {
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
