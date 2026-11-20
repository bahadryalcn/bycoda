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
import { DEFAULT_AGENT_DEFAULTS } from "../../tasks/public/agentDefaults";
import { acceptAgentDefaults, registerAgentDefaultsSync } from "./agentDefaultsStore";
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
it("keep-awake listeners hear Host snapshots, never localStorage events", () => {
  const callback = vi.fn();
  const save = vi.fn(async () => true);
  registerAgentDefaultsSync({ start: () => () => {}, save });
  const unsubscribe = subscribeKeepAwakeEnabled(callback);
  try {
    // A save is forwarded to the Host and is not reported durable until it is acknowledged.
    expect(saveKeepAwakeEnabled(true)).toBe(false);
    expect(save).toHaveBeenCalledWith("keepAwakeWhileAgentsWork", true);
    expect(loadKeepAwakeEnabled()).toBe(false);
    expect(callback).not.toHaveBeenCalled();
    // Another window's change reaches this one through the Host record.
    acceptAgentDefaults({
      agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, version: 1, keepAwakeWhileAgentsWork: true },
    });
    expect(loadKeepAwakeEnabled()).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "bycoda.keepAwakeWhileAgentsWork",
        storageArea: localStorage,
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
    expect(callback).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
  acceptAgentDefaults({ agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, version: 2 } });
  expect(callback).toHaveBeenCalledTimes(1);
});
it("does not publish an enum change after a failed save (#900)", () => {
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
    expect(details).toEqual([]);
    expect(callback).not.toHaveBeenCalled();
    expect(loadDiffLayout()).toBe("split");
  } finally {
    unsubscribe();
    window.removeEventListener(DIFF_LAYOUT_CHANGE_EVENT, listener);
  }
});
