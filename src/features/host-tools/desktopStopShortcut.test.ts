// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);
import {
  desktopStopShortcut,
  DESKTOP_STOP_COMMAND,
  DESKTOP_STOP_DEFAULT_SHORTCUT,
} from "../settings/model/desktopStopKeybinding";
import {
  loadKeybindingOverrides,
  prepareKeybindingOverride,
  saveKeybindingOverride,
} from "../settings/model/settings";
import { applyDesktopStopShortcut, startDesktopStopShortcut } from "./desktopStopShortcut";
beforeEach(() => {
  localStorage.clear();
  native.invoke.mockReset().mockResolvedValue(undefined);
  native.isTauri.mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());
it("uses the normal persisted override, explicit disabling and reset while preserving global and conflict requirements", () => {
  expect(desktopStopShortcut({})).toBe(DESKTOP_STOP_DEFAULT_SHORTCUT);
  saveKeybindingOverride(DESKTOP_STOP_COMMAND, { shortcut: "Control+Option+KeyX" });
  expect(desktopStopShortcut(loadKeybindingOverrides())).toBe("Control+Option+KeyX");
  saveKeybindingOverride(DESKTOP_STOP_COMMAND, { disabled: true });
  expect(desktopStopShortcut(loadKeybindingOverrides())).toBeNull();
  saveKeybindingOverride(DESKTOP_STOP_COMMAND, {});
  expect(desktopStopShortcut(loadKeybindingOverrides())).toBe(DESKTOP_STOP_DEFAULT_SHORTCUT);
  expect(() =>
    prepareKeybindingOverride(DESKTOP_STOP_COMMAND, { shortcut: "Option+KeyX" }),
  ).toThrow("global hotkey");
  expect(() =>
    prepareKeybindingOverride("App: Search", { shortcut: DESKTOP_STOP_DEFAULT_SHORTCUT }),
  ).toThrow("Already used");
});
it("registers sibling changes without owning another keyboard listener or disabling another workspace's shortcut on detach", async () => {
  const stop = startDesktopStopShortcut();
  expect(native.invoke).toHaveBeenLastCalledWith("desktop_shortcut_configure", {
    shortcut: DESKTOP_STOP_DEFAULT_SHORTCUT,
  });
  saveKeybindingOverride(DESKTOP_STOP_COMMAND, { disabled: true });
  expect(native.invoke).toHaveBeenLastCalledWith("desktop_shortcut_configure", { shortcut: null });
  const calls = native.invoke.mock.calls.length;
  stop();
  saveKeybindingOverride(DESKTOP_STOP_COMMAND, {});
  expect(native.invoke).toHaveBeenCalledTimes(calls);
  native.isTauri.mockReturnValue(false);
  startDesktopStopShortcut()();
  expect(native.invoke).toHaveBeenCalledTimes(calls);
});
it("does not persist a shortcut when native registration fails", async () => {
  native.invoke.mockRejectedValueOnce(new Error("OS conflict"));
  const next = prepareKeybindingOverride(DESKTOP_STOP_COMMAND, { shortcut: "Control+Option+KeyX" });
  await expect(applyDesktopStopShortcut(next)).rejects.toThrow("OS conflict");
  expect(loadKeybindingOverrides()[DESKTOP_STOP_COMMAND]).toBeUndefined();
});
