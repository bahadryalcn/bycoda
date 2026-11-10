// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);
import { DESKTOP_TALK_COMMAND, desktopTalkShortcut } from "./desktopStopKeybinding";
import {
  loadKeybindingOverrides,
  prepareKeybindingOverride,
  saveKeybindingOverride,
} from "./settings";
import { applyDesktopShortcuts, startDesktopTalkShortcut } from "./desktopTalkShortcut";
beforeEach(() => {
  localStorage.clear();
  native.invoke.mockReset().mockResolvedValue(undefined);
  native.isTauri.mockReturnValue(true);
});
it("is unset by default, persists a recorded chord and honours disabling", () => {
  expect(desktopTalkShortcut({})).toBeNull();
  saveKeybindingOverride(DESKTOP_TALK_COMMAND, { shortcut: "Control+Shift+KeyT" });
  expect(desktopTalkShortcut(loadKeybindingOverrides())).toBe("Control+Shift+KeyT");
  saveKeybindingOverride(DESKTOP_TALK_COMMAND, { disabled: true });
  expect(desktopTalkShortcut(loadKeybindingOverrides())).toBeNull();
});
it("requires a global modifier and refuses the emergency stop chord", () => {
  expect(() =>
    prepareKeybindingOverride(DESKTOP_TALK_COMMAND, { shortcut: "Option+KeyT" }),
  ).toThrow("global hotkey");
  expect(() =>
    prepareKeybindingOverride(DESKTOP_TALK_COMMAND, { shortcut: "Control+Option+Escape" }),
  ).toThrow("Already used");
});
it("registers the saved chord and follows sibling changes until detached", () => {
  saveKeybindingOverride(DESKTOP_TALK_COMMAND, { shortcut: "Control+Shift+KeyT" });
  const stop = startDesktopTalkShortcut();
  expect(native.invoke).toHaveBeenLastCalledWith("desktop_talk_shortcut_configure", {
    shortcut: "Control+Shift+KeyT",
  });
  saveKeybindingOverride(DESKTOP_TALK_COMMAND, { disabled: true });
  expect(native.invoke).toHaveBeenLastCalledWith("desktop_talk_shortcut_configure", {
    shortcut: null,
  });
  const calls = native.invoke.mock.calls.length;
  stop();
  saveKeybindingOverride(DESKTOP_TALK_COMMAND, { shortcut: "Control+Shift+KeyJ" });
  expect(native.invoke).toHaveBeenCalledTimes(calls);
});
it("reports a native registration failure to the caller", async () => {
  native.invoke.mockRejectedValueOnce(new Error("OS conflict"));
  await expect(applyDesktopShortcuts({})).rejects.toThrow("OS conflict");
});
