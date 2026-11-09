// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const overrides = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../../../../platform/tauri/platform", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  IS_MAC: false,
}));
vi.mock("../../../settings/public/settings", () => ({
  keybindingPressed: (command: string, _event: KeyboardEvent, defaultMatch: boolean) =>
    overrides.value[command] === "disabled" ? false : defaultMatch,
}));

import { VOICE_OPEN_COMPANION, voiceOpenShortcutPressed } from "./VoiceLauncher";

const press = (extra: KeyboardEventInit) =>
  voiceOpenShortcutPressed(new KeyboardEvent("keydown", { key: "K", cancelable: true, ...extra }));

afterEach(() => {
  overrides.value = {};
});

it("opens on Ctrl+Shift+K only, and honours a disabled binding", () => {
  expect(press({ ctrlKey: true, shiftKey: true })).toBe(true);
  expect(press({ ctrlKey: true })).toBe(false);
  expect(press({ ctrlKey: true, shiftKey: true, altKey: true })).toBe(false);
  expect(press({ metaKey: true, shiftKey: true })).toBe(false);
  expect(press({ ctrlKey: true, shiftKey: true, repeat: true })).toBe(false);
  overrides.value = { [VOICE_OPEN_COMPANION]: "disabled" };
  expect(press({ ctrlKey: true, shiftKey: true })).toBe(false);
});
