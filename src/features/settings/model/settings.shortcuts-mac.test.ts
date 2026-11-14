// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KEYBINDINGS, saveKeybindingOverride } from "./settings";

vi.mock("../../../platform/tauri/platform", () => ({
  IS_MAC: true,
  IS_WIN: false,
  IS_LINUX: false,
  HAS_NATIVE_GLASS: true,
  MOD: "⌘",
  ALT: "⌥",
  SHIFT: "⇧",
  FULLSCREEN_SHORTCUT: "⌃⌘F",
}));

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

it("reserves the canonical chord of a separately stored Mac Quick Composer shortcut", () => {
  expect(KEYBINDINGS.some((row) => row.command === "App: Quick Composer")).toBe(true);
  localStorage.setItem("bycoda.quickComposerShortcut", "Shift+Control+F23");
  expect(() => saveKeybindingOverride("App: Search", { shortcut: "Control+Shift+F23" })).toThrow(
    "Already used by App: Quick Composer",
  );
  expect(localStorage.getItem("bycoda.keybindingOverrides")).toBeNull();
});
