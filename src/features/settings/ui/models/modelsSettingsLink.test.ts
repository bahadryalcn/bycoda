// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import {
  MODELS_TABS,
  modelsTabAnchor,
  openModelsSettings,
  OPEN_MODELS_SETTINGS_EVENT,
} from "./modelsSettingsLink";
import {
  settingsSectionForAnchor,
  searchSettings,
  settingsSectionPresentation,
} from "../../model/settings";
import { providersTabForSetting } from "../../model/providerSettingsTabs";

it("routes every Models anchor and retired section to the one Models page", () => {
  expect(MODELS_TABS).toEqual(["order", "roles", "chat", "delegation"]);
  const tabs = { order: "work", roles: "work", chat: "chat", delegation: "delegation" };
  for (const tab of MODELS_TABS) {
    const anchor = modelsTabAnchor(tab);
    expect(providersTabForSetting(anchor)).toBe(tabs[tab]);
    expect(settingsSectionForAnchor("providers", anchor)).toBe("providers");
  }
  expect(settingsSectionForAnchor("work")).toBe("providers");
  expect(settingsSectionForAnchor("models")).toBe("providers");
  expect(providersTabForSetting("agent-clis")).toBe("chat");
  expect(providersTabForSetting("subagent-max-effort")).toBe("delegation");
  expect(providersTabForSetting("enabled-models")).toBe("providers");
  expect(providersTabForSetting("decision-models")).toBe("providers");
  expect(providersTabForSetting(null)).toBeUndefined();
  expect(settingsSectionPresentation("models")).toBe("wide");
});

it.each([
  "Default provider",
  "Model",
  "Effort",
  "Permissions",
  "Fast",
  "Subagents",
  "Advisor",
  "Subagent max effort",
  "Image models",
])("keeps %s searchable in Models", (label) => {
  expect(searchSettings(label).some((result) => result.section === "providers")).toBe(true);
});

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
