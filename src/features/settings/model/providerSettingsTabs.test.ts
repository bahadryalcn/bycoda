import { expect, it } from "vitest";
import { providersTabForSetting, PROVIDERS_TABS } from "./providerSettingsTabs";
it("routes every installation reveal and provider option to the Providers tab", () => {
  expect(PROVIDERS_TABS).toEqual(["work", "chat", "delegation", "providers"]);
  for (const id of [
    "harness-updates",
    "cli-path-codex",
    "cli-path-claude",
    "claude-hooks",
    "acp-registry",
    "provider-accounts",
    "terminal-account-profiles-codex",
    "enabled-models",
    "decision-models",
  ])
    expect(providersTabForSetting(id)).toBe("providers");
});

it("opens conversation defaults inside Chats for existing model links", () => {
  for (const id of ["models-chat", "default-provider", "agent-clis"])
    expect(providersTabForSetting(id)).toBe("chat");
});

it("routes model order and roles to Background work and subagents to Subagents", () => {
  for (const id of ["models-order", "models-roles"])
    expect(providersTabForSetting(id)).toBe("work");
  for (const id of ["models-delegation", "advisor", "image-models"])
    expect(providersTabForSetting(id)).toBe("delegation");
});
