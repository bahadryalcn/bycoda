import { expect, it } from "vitest";
import { providersTabForSetting, PROVIDERS_TABS } from "./providerSettingsTabs";
it("routes every installation reveal to CLI and provider options to Accounts", () => {
  expect(PROVIDERS_TABS).toEqual(["providers", "defaults", "cli", "models", "decision"]);
  for (const id of ["harness-updates", "cli-path-codex", "cli-path-claude"])
    expect(providersTabForSetting(id)).toBe("cli");
  for (const id of [
    "claude-hooks",
    "acp-registry",
    "provider-accounts",
    "terminal-account-profiles-codex",
  ])
    expect(providersTabForSetting(id)).toBe("providers");
});

it("opens conversation defaults inside Providers for existing model links", () => {
  for (const id of ["models-chat", "default-provider", "agent-clis"])
    expect(providersTabForSetting(id)).toBe("defaults");
});
