// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  loadKeepAwakeEnabled,
  saveKeepAwakeEnabled,
  subscribeKeepAwakeEnabled,
  loadDiffLayout,
  saveDiffLayout,
  subscribeDiffLayout,
  DIFF_LAYOUT_CHANGE_EVENT,
  loadSettingsSection,
  loadSettingsAliasAnchor,
  saveSettingsSection,
  settingsSectionForAnchor,
} from "./settings";
import { TOOL_SETTINGS_TAB_ANCHORS, type ToolSettingsTab } from "./toolSettingsSections";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("reopens saved Models settings in Providers Defaults", () => {
  localStorage.setItem("bycoda.settingsSection", "models");
  expect(loadSettingsSection()).toBe("providers");
  expect(loadSettingsAliasAnchor()).toBe("models-chat");
});

it.each(Object.entries(TOOL_SETTINGS_TAB_ANCHORS) as [ToolSettingsTab, string][])(
  "migrates the %s section to its canonical page and destination",
  (alias, anchor) => {
    localStorage.setItem("bycoda.settingsSection", alias);
    expect(loadSettingsSection()).toBe("tools");
    expect(loadSettingsAliasAnchor()).toBe(anchor);
    expect(settingsSectionForAnchor(alias)).toBe("tools");
    expect(settingsSectionForAnchor("general", anchor)).toBe("tools");
    saveSettingsSection(alias);
    expect(localStorage.getItem("bycoda.settingsSection")).toBe("tools");
  },
);
it("the cross-tab owner receives same-key and clear events but not sessionStorage events", () => {
  const callback = vi.fn();
  const unsubscribe = subscribeKeepAwakeEnabled(callback);
  try {
    saveKeepAwakeEnabled(true);
    expect(loadKeepAwakeEnabled()).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "bycoda.keepAwakeWhileAgentsWork",
        storageArea: sessionStorage,
      }),
    );
    expect(callback).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "bycoda.keepAwakeWhileAgentsWork",
        storageArea: localStorage,
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
    expect(callback).toHaveBeenCalledTimes(3);
  } finally {
    unsubscribe();
  }
  window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
  expect(callback).toHaveBeenCalledTimes(3);
});
it("keeps enum normalization and the event detail/load split after a failed save", () => {
  saveDiffLayout("split");
  const callback = vi.fn();
  const unsubscribe = subscribeDiffLayout(callback);
  const details: unknown[] = [];
  const listener = (event: Event) => details.push((event as CustomEvent).detail);
  window.addEventListener(DIFF_LAYOUT_CHANGE_EVENT, listener);
  try {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    saveDiffLayout("invalid" as "inline");
    expect(details).toEqual(["auto"]);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(loadDiffLayout()).toBe("split");
  } finally {
    unsubscribe();
    window.removeEventListener(DIFF_LAYOUT_CHANGE_EVENT, listener);
  }
});
