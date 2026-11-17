import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// The mobile app bundles shared models that reach these modules. React Native defines `window`
// and `navigator` without DOM events, `platform` or `language`; loading must not throw there.
it("loads platform flags and translations in a React Native-like global scope", async () => {
  vi.resetModules();
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", {});
  const platform = await import("../../platform/tauri/platform");
  expect([platform.IS_MAC, platform.IS_WIN, platform.IS_LINUX]).toEqual([false, false, false]);
  const core = await import("./core");
  expect(core.t("Cancel")).toBe("Cancel");
  await expect(import("../../features/sessions/model/models")).resolves.toBeDefined();
});
