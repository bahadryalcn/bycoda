import {
  EMPTY_MODEL_ROUTING,
  ModelRoutingDraftSchema,
  type ModelRoutingState,
} from "../../../src/shared/model/host-contracts/model-routing";
import { parseHostSettings } from "../../../src/features/tasks/public/hostSettings";
import { modelDisplayName } from "../../../src/features/sessions/public/modelDisplayName";

const machine = {
  id: "fixture-work",
  name: "This computer (local sync)",
  localHost: true,
  endpoint: "http://127.0.0.1:9999",
  environmentId: "fixture-work",
};
const redesign = new URLSearchParams(location.search).get("workFixture") === "routing";
const removedAccount = new URLSearchParams(location.search).has("removedRoutingAccount");
const routingEntry = (
  id: string,
  harness: "claude" | "codex",
  model: string,
  providerAccountId?: string,
) => ({
  id,
  harness,
  model,
  ...(providerAccountId ? { providerAccountId } : {}),
  modelSettings: {},
  unknownLimit: "use" as const,
});
/** `?workFixture=routing`: two accounts (work and personal), nested pools and one skipped entry. */
const routingState: ModelRoutingState = {
  ...structuredClone(EMPTY_MODEL_ROUTING),
  version: 1,
  updatedAt: 1,
  entries: [
    routingEntry(
      "r-opus",
      "claude",
      "claude:opus",
      removedAccount ? "removed-fixture" : "account-work",
    ),
    routingEntry("r-sol", "codex", "codex:gpt-6.1-sol"),
    routingEntry("r-sonnet", "claude", "claude:sonnet"),
    routingEntry("r-terra", "codex", "codex:gpt-6.1-terra"),
    routingEntry("r-haiku", "claude", "claude:haiku", "account-work"),
    routingEntry("r-luna", "codex", "codex:gpt-5.6-luna"),
  ],
  pools: [
    { id: "r-smart", name: "Smartest", entryIds: ["r-opus", "r-sol"] },
    { id: "r-work", name: "Work", entryIds: ["r-haiku"], poolIds: ["r-smart"] },
  ],
  roles: { "task.reviewer": { kind: "pool", poolId: "r-work" } },
  delegation: { global: { crossSubagents: "auto" }, providers: {}, accounts: {} },
  defaultMaxRunMinutes: 30,
  workCaps: { total: { daily: { tokens: 100000, costUsd: 10 } } },
};
let state: ModelRoutingState = redesign
  ? routingState
  : {
      ...structuredClone(EMPTY_MODEL_ROUTING),
      version: 1,
      updatedAt: 1,
      entries: [
        {
          id: "fixture-codex",
          harness: "codex",
          model: "codex:gpt-5.3-codex",
          modelSettings: {},
          unknownLimit: "use",
          minRemainingPercent: 15,
        },
        {
          id: "fixture-claude",
          harness: "claude",
          model: "claude:sonnet",
          modelSettings: {},
          unknownLimit: "skip",
        },
      ],
      pools: [
        {
          id: "fixture-review",
          name: "Independent review",
          entryIds: ["fixture-claude", "fixture-codex"],
        },
      ],
      roles: {
        "task.reviewer": { kind: "pool", poolId: "fixture-review" },
        "goal.finalReview": { kind: "pool", poolId: "fixture-review" },
      },
      delegation: { global: { crossSubagents: "auto" }, providers: {}, accounts: {} },
      defaultMaxRunMinutes: 30,
      workCaps: {
        total: {
          daily: { tokens: 100000, costUsd: 10 },
          monthly: { tokens: 2000000, costUsd: 200 },
        },
      },
    };
if (new URLSearchParams(location.search).get("workFixture") === "empty")
  state = { ...structuredClone(EMPTY_MODEL_ROUTING), version: 1, updatedAt: 1 };
let settings = { maxRunningTasks: 2, dailyAgentMinutes: 120, usedMinutes: 75, limitReached: false };

/** In-memory Host contract for populated Work visual fixtures, never owner data. */
export function workSettingsFixture(
  command: string,
  args: Record<string, unknown>,
): { value: unknown } | undefined {
  if (!new URLSearchParams(location.search).has("workFixture")) return undefined;
  if (command === "remote_machines") return { value: [machine] };
  if (command === "local_host_connect") return { value: machine };
  if (command !== "remote_request") return undefined;
  if (args.machineId !== machine.id) throw new Error("Work fixture Host identity changed.");
  if (args.method === "environment.describe")
    return {
      value: {
        environmentId: machine.environmentId,
        capabilities: ["models.routing.v1", "host.settings", "usage.planShare.v1"],
      },
    };
  if (args.method === "projects.list") return { value: [] };
  if (args.method === "models.list" && redesign)
    return {
      value: {
        models: Object.fromEntries(
          ["claude", "codex"].map((provider) => [
            provider,
            routingState.entries
              .filter((entry) => entry.harness === provider)
              .map((entry) => ({
                id: entry.model,
                harness: entry.harness,
                name: modelDisplayName(entry.model, entry.harness),
              })),
          ]),
        ),
        errors: {},
      },
    };
  if (args.method === "modelRouting.get") return { value: { state: structuredClone(state) } };
  if (args.method === "modelRouting.status")
    return {
      value: {
        entries: state.entries.map((entry, index) => ({
          entryId: entry.id,
          leftPercent: index ? 62 : 84,
          ...(redesign && entry.id === "r-sonnet" ? { skip: "otherScope" as const } : {}),
        })),
      },
    };
  if (args.method === "modelRouting.resolve" && !state.entries.length)
    return { value: { resolution: { ok: false, reason: "notConfigured", skipped: [] } } };
  if (args.method === "modelRouting.resolve")
    return {
      value: {
        resolution: {
          ok: true,
          target: {
            harness: state.entries[0].harness,
            model: state.entries[0].model,
            providerAccountId: state.entries[0].providerAccountId,
            modelSettings: state.entries[0].modelSettings,
          },
          source: { kind: "order", entryId: state.entries[0].id },
          skipped: [],
        },
      },
    };
  if (args.method === "modelRouting.save") {
    const input = args.params as { expectedVersion: number; draft: unknown };
    if (input.expectedVersion !== state.version)
      throw new Error("Model routing changed; reload before saving.");
    state = {
      ...ModelRoutingDraftSchema.parse(input.draft),
      version: state.version + 1,
      updatedAt: state.updatedAt + 1,
    };
    return { value: { state: structuredClone(state) } };
  }
  if (args.method === "host.settings.get") return { value: settings };
  if (args.method === "usage.planShare.read")
    return {
      value: {
        environmentId: machine.environmentId,
        sampledAt: Date.now(),
        estimate: true,
        window: (args.params as { window: string }).window,
        coverage: { pricing: "built-in", filesScanned: 0, truncated: false },
        accounts: [],
      },
    };
  if (args.method === "host.settings.save") {
    const input = args.params as { settings: unknown };
    settings = { ...settings, ...parseHostSettings(input.settings, settings) };
    return { value: settings };
  }
  return undefined;
}
