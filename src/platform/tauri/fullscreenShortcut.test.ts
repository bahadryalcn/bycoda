import { describe, expect, it } from "vitest";
import { isFullscreenShortcut } from "./platform";

const key = (key: string, modifiers = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("platform fullscreen shortcuts", () => {
  it("uses unmodified F11 on Windows and Linux", () => {
    expect(isFullscreenShortcut(key("F11"), false)).toBe(true);
    for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey"]) {
      expect(isFullscreenShortcut(key("F11", { [modifier]: true }), false)).toBe(false);
    }
    expect(isFullscreenShortcut(key("f", { ctrlKey: true, metaKey: true }), false)).toBe(false);
  });

  it("uses Control+Command+F on macOS", () => {
    expect(isFullscreenShortcut(key("f", { ctrlKey: true, metaKey: true }), true)).toBe(true);
    expect(isFullscreenShortcut(key("F", { ctrlKey: true, metaKey: true }), true)).toBe(true);
    expect(isFullscreenShortcut(key("F11"), true)).toBe(false);
    expect(isFullscreenShortcut(key("f", { metaKey: true }), true)).toBe(false);
    expect(isFullscreenShortcut(key("f", { ctrlKey: true }), true)).toBe(false);
    expect(
      isFullscreenShortcut(key("f", { ctrlKey: true, metaKey: true, shiftKey: true }), true),
    ).toBe(false);
    expect(
      isFullscreenShortcut(key("f", { ctrlKey: true, metaKey: true, altKey: true }), true),
    ).toBe(false);
  });
});
