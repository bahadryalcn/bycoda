import { afterEach, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ mac: false, windows: true }));
vi.mock("../../../platform/tauri/platform", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/platform")>()),
  get IS_MAC() {
    return platform.mac;
  },
  get IS_WIN() {
    return platform.windows;
  },
}));

afterEach(() => vi.resetModules());

it.each([
  { mac: true, windows: false, supported: true, shortcut: "Command+Shift+Space" },
  { mac: false, windows: true, supported: true, shortcut: "Control+Shift+Space" },
  { mac: false, windows: false, supported: false, shortcut: "Control+Shift+Space" },
])("exposes quick composer with the platform default: %j", async (value) => {
  platform.mac = value.mac;
  platform.windows = value.windows;
  const { quickComposerSupported } = await import("./quickComposer");
  const { QUICK_COMPOSER_DEFAULT_SHORTCUT } = await import("./quickComposerShortcut");
  const { KEYBINDINGS, SETTINGS_INDEX } = await import("../../settings/model/settings");
  expect(quickComposerSupported()).toBe(value.supported);
  expect(QUICK_COMPOSER_DEFAULT_SHORTCUT).toBe(value.shortcut);
  expect(KEYBINDINGS.some((row) => row.command === "App: Quick Composer")).toBe(value.supported);
  expect(SETTINGS_INDEX.some((row) => row.id === "quick-composer")).toBe(value.supported);
});
