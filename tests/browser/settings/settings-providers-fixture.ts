import { HARNESS_TITLE } from "../../../src/shared/model/harnessIdentity";
import { registerBuiltinHarnesses } from "../../../src/integrations/harness/core/register";
import { configureChildBackend } from "../../../src/integrations/harness/core/child";
import { HARNESSES } from "../../../src/features/sessions/model/session";
import {
  setHarnessAvailability,
  markHarnessAvailabilityProbed,
} from "../../../src/integrations/harness/core/availabilityState";
import { getHarnessUpdateSnapshot } from "../../../src/features/providers/model/harnessUpdateActions";

const enabled = new URLSearchParams(location.search).has("providersFixture");
const versions: Record<string, string> = {
  claude: "2.1.12",
  codex: "0.94.0",
  cursor: "1.2.4",
  grok: "0.3.0",
  opencode: "1.3.2",
  pi: "0.51.0",
};
const accounts = {
  claude: [
    {
      id: "default",
      provider: "claude",
      label: "Personal",
      kind: "personal",
      color: "purple",
      isDefault: true,
    },
    {
      id: "account-work",
      provider: "claude",
      label: "Engineering workspace",
      kind: "work",
      color: "teal",
    },
    {
      id: "account-old",
      provider: "claude",
      label: "Previous workspace",
      kind: "work",
      color: "amber",
    },
  ],
  codex: [
    {
      id: "default",
      provider: "codex",
      label: "Personal",
      kind: "personal",
      color: "blue",
      isDefault: true,
    },
  ],
};

/** Explicit opt-in synthetic state. Mutates this fixture bundle's memory only. */
export function seedProvidersFixture() {
  if (!enabled) return;
  if (new URLSearchParams(location.search).has("longNames")) {
    HARNESS_TITLE.codex = "Codex with a very long provider display name";
    accounts.codex[0].label = "Personal account with a very long display name";
  }
  registerBuiltinHarnesses();
  configureChildBackend({
    invoke: async <T>(command: string, args: Record<string, unknown> = {}) => {
      const value = providersFixtureCommand(command, args);
      if (value === undefined)
        throw new Error(`Unavailable in Providers screenshot backend: ${command}`);
      return (await value) as T;
    },
    listen: async () => () => {},
  });
  localStorage.setItem("bycoda.providerAccounts.v2", JSON.stringify(accounts));
  localStorage.setItem(
    "bycoda.lastModel",
    JSON.stringify({ harness: "codex", model: "codex:gpt-5.3-codex" }),
  );
  localStorage.setItem(
    "bycoda.defaultModels",
    JSON.stringify({ global: { harness: "codex", model: "codex:gpt-5.3-codex" } }),
  );
  setHarnessAvailability(
    Object.fromEntries(
      HARNESSES.map((id) => [id, id in versions || id === "antigravity"]),
    ) as Record<(typeof HARNESSES)[number], boolean>,
  );
  markHarnessAvailabilityProbed();
  getHarnessUpdateSnapshot().checks = Object.entries(versions).map(([harness, installed]) => ({
    harness: harness as (typeof HARNESSES)[number],
    installed,
    latest: harness === "codex" ? "0.95.0" : installed,
    status: harness === "codex" ? "behind" : "current",
  }));
}

/** Unknown commands still fail closed in the parent fixture. */
export function providersFixtureCommand(command: string, args: Record<string, unknown>): unknown {
  if (!enabled) return undefined;
  if (command === "provider_account_list" || command === "provider_accounts")
    return Object.values(accounts).flat();
  if (command === "provider_account_identity")
    return args.accountId === "account-old"
      ? null
      : {
          email: `${args.accountId}@example.test`,
          name: "Fixture owner",
          organization:
            args.accountId === "account-work" ? "Engineering" : "Fixture owner's Organization",
          plan: "Pro",
        };
  if (command.startsWith("fetch_claude_usage"))
    return args.accountId === "account-old"
      ? { status: "unavailable", error: "Claude not signed in" }
      : {
          status: "ok",
          body: JSON.stringify({
            five_hour: { utilization: 14, resets_at: new Date(Date.now() + 7200000).toISOString() },
            seven_day: {
              utilization: 32,
              resets_at: new Date(Date.now() + 172800000).toISOString(),
            },
          }),
        };
  if (command === "harness_management_grant") return { token: "fixture", routeId: "fixture-route" };
  if (command === "harness_exec") {
    const provider = String(args.binaryProvider);
    if (provider === "pi" && sessionStorage.getItem("fixture-check-pending") === "1")
      return new Promise(() => {});
    return `${provider === "codex" ? "codex-cli" : provider} ${versions[provider] ?? "1.0.0"}`;
  }
  if (command === "harness_latest_version")
    return args.provider === "codex" ? "0.95.0" : (versions[String(args.provider)] ?? "1.0.0");
  if (command === "home_dir") return "/fixture/home";
  if (command === "harness_spawn") throw new Error("Codex not signed in");
  if (command === "plugin:path|resolve_directory") return "/fixture/home";
  if (command.startsWith("harness_resolve_")) {
    const provider = command.slice("harness_resolve_".length);
    if (!(provider in versions) && provider !== "antigravity")
      throw new Error("Fixture CLI not installed");
    return { path: `/fixture/bin/${provider}` };
  }
  return undefined;
}
