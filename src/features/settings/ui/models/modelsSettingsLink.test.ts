// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import {
  MODELS_TABS,
  modelsTabAnchor,
  modelsTabForSetting,
  openModelsSettings,
  OPEN_MODELS_SETTINGS_EVENT,
} from "./modelsSettingsLink";
import {
  settingsSectionForAnchor,
  searchSettings,
  settingsSectionPresentation,
} from "../../model/settings";
import { providersTabForSetting } from "../../model/providerSettingsTabs";

it("routes work tabs and provider defaults to their settings sections", () => {
  expect(MODELS_TABS).toEqual(["order", "roles", "chat", "delegation"]);
  for (const tab of MODELS_TABS) {
    const anchor = modelsTabAnchor(tab);
    expect(modelsTabForSetting(anchor)).toBe(tab);
    expect(settingsSectionForAnchor("providers", anchor)).toBe(tab === "chat" ? "models" : "work");
  }
  expect(settingsSectionForAnchor("providers", "agent-clis")).toBe("models");
  expect(modelsTabForSetting("agent-clis")).toBe("chat");
  expect(providersTabForSetting("agent-clis")).toBeUndefined();
  expect(modelsTabForSetting(null)).toBeUndefined();
  expect(modelsTabForSetting("enabled-models")).toBeUndefined();
  expect(settingsSectionPresentation("models")).toBe("wide");
});

it.each(["Default provider", "Model", "Effort", "Permissions", "Fast"])(
  "keeps %s searchable in Models",
  (label) => {
    expect(searchSettings(label).some((result) => result.section === "models")).toBe(true);
  },
);

it("emits a Models tab request for the workspace surface", () => {
  const listener = vi.fn();
  window.addEventListener(OPEN_MODELS_SETTINGS_EVENT, listener);
  try {
    openModelsSettings("delegation");
    expect(listener.mock.calls[0][0].detail).toBe("delegation");
  } finally {
    window.removeEventListener(OPEN_MODELS_SETTINGS_EVENT, listener);
  }
});

it.each(["Subagents", "Advisor", "Subagent max effort", "Image models"])(
  "keeps %s searchable in Work",
  (label) => {
    expect(searchSettings(label).some((result) => result.section === "work")).toBe(true);
  },
);
