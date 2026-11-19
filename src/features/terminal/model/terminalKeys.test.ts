import { describe, expect, it } from "vitest";
import {
  isMacTerminalClearShortcut,
  isTerminalControlKey,
  macTerminalShortcutData,
  terminalToolShortcut,
} from "./terminalKeys";

it("reserves terminal tools while preserving find-in-files and macOS fullscreen", () => {
  expect(terminalToolShortcut(key("f", { ctrlKey: true }))).toBe("search");
  expect(terminalToolShortcut(key("f", { metaKey: true }))).toBe("search");
  expect(terminalToolShortcut(key(" ", { ctrlKey: true }))).toBe("command");
  expect(terminalToolShortcut(key("f", { ctrlKey: true, shiftKey: true }))).toBeNull();
  expect(terminalToolShortcut(key("f", { ctrlKey: true, metaKey: true }))).toBeNull();
  expect(terminalToolShortcut(key("Tab"))).toBeNull();
});

it("leaves remote shell assistance keys to the PTY when app suggestions are unavailable", () => {
  for (const event of [
    key("ArrowUp"),
    key("ArrowDown"),
    key("Tab"),
    key("r", { ctrlKey: true }),
    key(" ", { ctrlKey: true }),
    key("Escape"),
  ]) {
    expect(terminalToolShortcut(event, false)).toBeNull();
  }
  expect(terminalToolShortcut(key("f", { ctrlKey: true }), false)).toBe("search");
});

function key(
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">> = {},
) {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

describe("mac terminal editing shortcuts", () => {
  it("sends shell word movement for Option+Arrow", () => {
    expect(macTerminalShortcutData(key("ArrowLeft", { altKey: true }))).toBe("\x1bb");
    expect(macTerminalShortcutData(key("ArrowRight", { altKey: true }))).toBe("\x1bf");
  });

  it("sends line movement and deletion for Command shortcuts", () => {
    expect(macTerminalShortcutData(key("ArrowLeft", { metaKey: true }))).toBe("\x01");
    expect(macTerminalShortcutData(key("ArrowRight", { metaKey: true }))).toBe("\x05");
    expect(macTerminalShortcutData(key("Backspace", { metaKey: true }))).toBe("\x15");
  });

  it("leaves other modifiers and keys to xterm and app shortcuts", () => {
    expect(macTerminalShortcutData(key("ArrowLeft", { metaKey: true, altKey: true }))).toBeNull();
    expect(macTerminalShortcutData(key("ArrowLeft", { altKey: true, shiftKey: true }))).toBeNull();
    expect(macTerminalShortcutData(key("ArrowLeft", { ctrlKey: true }))).toBeNull();
    expect(macTerminalShortcutData(key("Backspace", { altKey: true }))).toBeNull();
    expect(macTerminalShortcutData(key("Delete", { metaKey: true }))).toBeNull();
  });
});

describe("mac terminal clear shortcut", () => {
  it("matches Command+K only", () => {
    expect(isMacTerminalClearShortcut(key("k", { metaKey: true }))).toBe(true);
    expect(isMacTerminalClearShortcut(key("K", { metaKey: true }))).toBe(true);
    expect(isMacTerminalClearShortcut(key("k", { ctrlKey: true }))).toBe(false);
    expect(isMacTerminalClearShortcut(key("k", { metaKey: true, shiftKey: true }))).toBe(false);
    expect(isMacTerminalClearShortcut(key("k", { metaKey: true, altKey: true }))).toBe(false);
    expect(isMacTerminalClearShortcut(key("j", { metaKey: true }))).toBe(false);
  });
});

it("claims only plain Ctrl+letter as terminal control input", () => {
  for (const letter of ["w", "d", "t", "n", "b", "p", "o", "j", "k"]) {
    expect(isTerminalControlKey(key(letter, { ctrlKey: true }))).toBe(true);
  }
  // Non-Latin layouts report a non-ASCII key; the physical code still identifies the letter.
  expect(isTerminalControlKey({ ...key("ц", { ctrlKey: true }), code: "KeyW" })).toBe(true);
  for (const event of [
    key("w"),
    key("w", { ctrlKey: true, shiftKey: true }),
    key("w", { ctrlKey: true, altKey: true }),
    key("w", { ctrlKey: true, metaKey: true }),
    key("Tab", { ctrlKey: true }),
    key("1", { ctrlKey: true }),
    key(",", { ctrlKey: true }),
    key("`", { ctrlKey: true }),
  ]) {
    expect(isTerminalControlKey(event)).toBe(false);
  }
});
