import {
  EMPTY_MODEL_ROUTING,
  ModelRoutingDraftSchema,
  type ModelRoutingState,
} from "../../../src/shared/model/host-contracts/model-routing";
import { parseHostSettings } from "../../../src/features/tasks/public/hostSettings";

const machine = {
  id: "fixture-work",
  name: "This computer (local sync)",
  localHost: true,
  endpoint: "http://127.0.0.1:9999",
  environmentId: "fixture-work",
};
let state: ModelRoutingState = {
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
    total: { daily: { tokens: 100000, costUsd: 10 }, monthly: { tokens: 2000000, costUsd: 200 } },
  },
};
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
        capabilities: ["models.routing.v1", "host.settings"],
      },
    };
  if (args.method === "projects.list") return { value: [] };
  if (args.method === "modelRouting.get") return { value: { state: structuredClone(state) } };
  if (args.method === "modelRouting.status")
    return {
      value: {
        entries: state.entries.map((entry, index) => ({
          entryId: entry.id,
          leftPercent: index ? 62 : 84,
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
  if (args.method === "host.settings.save") {
    const input = args.params as { settings: unknown };
    settings = { ...settings, ...parseHostSettings(input.settings, settings) };
    return { value: settings };
  }
  return undefined;
}
