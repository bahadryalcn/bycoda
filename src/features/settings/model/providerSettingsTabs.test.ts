import { expect, it } from "vitest";
import { providersTabForSetting, PROVIDERS_TABS } from "./providerSettingsTabs";
it("routes every installation reveal and provider option to the Providers tab", () => {
  expect(PROVIDERS_TABS).toEqual(["work", "defaults", "providers"]);
  for (const id of [
    "harness-updates",
    "cli-path-codex",
    "cli-path-claude",
    "claude-hooks",
    "acp-registry",
    "provider-accounts",
    "terminal-account-profiles-codex",
    "enabled-models",
  ])
    expect(providersTabForSetting(id)).toBe("providers");
});

it("leaves decision models to their own Settings page", () => {
  expect(providersTabForSetting("decision-models")).toBeUndefined();
});

it("opens chat and subagent defaults inside Defaults for existing model links", () => {
  for (const id of [
    "models-chat",
    "default-provider",
    "agent-clis",
    "models-delegation",
    "advisor",
    "image-models",
  ])
    expect(providersTabForSetting(id)).toBe("defaults");
});

it("routes model order and roles to Background work", () => {
  for (const id of ["models-order", "models-roles"])
    expect(providersTabForSetting(id)).toBe("work");
});
