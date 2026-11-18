import { expect, it, vi } from "vitest";
import { EMPTY_MODEL_ROUTING } from "../../src/shared/model/host-contracts/model-routing";
import { createHostModelRoutingService, hostModelRoutingService } from "./runtime";
import { createModelRoutingService, type ModelRoutingPorts } from "./service";
import { readDisabledModels } from "../providers/disabled-models";
import { providerAuthStatus } from "../providers/provider-auth";

const warm = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./service", () => ({ createModelRoutingService: vi.fn((ports) => ports) }));
vi.mock("../providers/disabled-models", () => ({
  readDisabledModels: vi.fn(async () => ["claude:opus-4.7"]),
}));
vi.mock("../providers/provider-accounts", () => ({
  hostProviderAccounts: vi.fn(async () => ({ codex: [{ id: "work" }] })),
}));
vi.mock("../providers/provider-auth", () => ({
  providerAuthStatus: vi.fn(async () => "signedOut"),
}));
vi.mock("../assistant/models/assistant-quota-reader", () => ({
  QUOTA_WARM_TIMEOUT_MS: 8_000,
  AssistantQuotaReader: class {
    reading = vi.fn(() => ({ leftPercent: 42 }));
    warm = warm;
  },
}));

it("uses catalog, disabled preferences, account auth and quota without picker fallback", async () => {
  createHostModelRoutingService({
    store: {} as never,
    catalog: async () => ({
      models: {
        claude: [{ id: "claude:claude-opus-4-7" }],
        codex: [{ id: "codex:x" }],
        grok: [{ id: "grok:x" }],
      },
    }),
    command: async () => "cli",
    readLimits: vi.fn(),
  });
  const ports = vi.mocked(createModelRoutingService).mock.calls.at(-1)![0] as ModelRoutingPorts;
  const entries = [
    {
      id: "a",
      harness: "claude" as const,
      model: "claude:claude-opus-4-7",
      modelSettings: {},
      unknownLimit: "use" as const,
    },
    {
      id: "b",
      harness: "codex" as const,
      providerAccountId: "work",
      model: "codex:x",
      modelSettings: {},
      unknownLimit: "use" as const,
    },
    {
      id: "c",
      harness: "codex" as const,
      providerAccountId: "missing",
      model: "codex:x",
      modelSettings: {},
      unknownLimit: "use" as const,
    },
    {
      id: "d",
      harness: "grok" as const,
      model: "grok:x",
      modelSettings: {},
      unknownLimit: "use" as const,
    },
  ];
  const signals = await ports.signals({ ...EMPTY_MODEL_ROUTING, entries });
  expect(signals.available(entries[0]!)).toBe(false);
  expect(signals.available(entries[1]!)).toBe(true);
  expect(signals.available({ ...entries[1]!, model: "missing" })).toBe(false);
  expect(signals.signedIn(entries[1]!)).toBe(false);
  expect(signals.signedIn(entries[2]!)).toBe(false);
  expect(signals.signedIn(entries[3]!)).toBe(true);
  expect(signals.quota(entries[1]!)).toEqual({ leftPercent: 42 });
  expect(providerAuthStatus).toHaveBeenCalledTimes(2);
  vi.mocked(providerAuthStatus).mockResolvedValue("unknown");
  vi.mocked(readDisabledModels).mockResolvedValue([]);
  const unknown = await ports.signals({ ...EMPTY_MODEL_ROUTING, entries }, { awaitQuota: true });
  expect(unknown.signedIn(entries[1]!)).toBe(true);
  expect(unknown.available(entries[0]!)).toBe(true);
});

it("probes each account once for run-start resolutions and again for the settings read", async () => {
  vi.mocked(providerAuthStatus).mockClear();
  vi.mocked(providerAuthStatus).mockResolvedValue("signedOut");
  createHostModelRoutingService({
    store: {} as never,
    catalog: async () => ({ models: {} }),
    command: async () => "cli",
    readLimits: vi.fn(),
  });
  const ports = vi.mocked(createModelRoutingService).mock.calls.at(-1)![0] as ModelRoutingPorts;
  const entry = {
    id: "a",
    harness: "codex" as const,
    providerAccountId: "work",
    model: "m",
    modelSettings: {},
    unknownLimit: "use" as const,
  };
  const state = { ...EMPTY_MODEL_ROUTING, entries: [entry] };
  expect((await ports.signals(state)).signedIn(entry)).toBe(false);
  expect((await ports.signals(state)).signedIn(entry)).toBe(false);
  expect(providerAuthStatus).toHaveBeenCalledTimes(1);
  await ports.signals(state, { awaitQuota: true });
  expect(providerAuthStatus).toHaveBeenCalledTimes(2);
});

it("awaits one bounded quota warm-up for the settings status read only", async () => {
  createHostModelRoutingService({
    store: {} as never,
    catalog: async () => ({ models: {} }),
    command: async () => "cli",
    readLimits: vi.fn(),
  });
  const ports = vi.mocked(createModelRoutingService).mock.calls.at(-1)![0] as ModelRoutingPorts;
  const entry = (id: string, harness: "claude" | "codex") => ({
    id,
    harness,
    model: "m",
    modelSettings: {},
    unknownLimit: "use" as const,
  });
  const state = { ...EMPTY_MODEL_ROUTING, entries: [entry("a", "claude"), entry("b", "codex")] };
  warm.mockClear();
  await ports.signals(state);
  expect(warm).not.toHaveBeenCalled();
  await ports.signals(state, { awaitQuota: true });
  expect(warm.mock.calls.map((call: unknown[]) => call[0])).toEqual(["claude", "codex"]);
  // One shared budget across providers, never a fresh full wait per provider.
  for (const call of warm.mock.calls as unknown[][]) {
    expect(call[1]).toBeGreaterThan(0);
    expect(call[1]).toBeLessThanOrEqual(8_000);
  }
});

it("gives a store without a registered service a store-only one instead of failing runs", async () => {
  const store = {} as never;
  const service = hostModelRoutingService(store);
  expect(hostModelRoutingService(store)).toBe(service);
  const ports = vi.mocked(createModelRoutingService).mock.calls.at(-1)![0] as ModelRoutingPorts;
  expect(ports.store).toBe(store);
  expect(await ports.catalog()).toBeUndefined();
  const signals = await ports.signals(EMPTY_MODEL_ROUTING);
  const entry = {
    id: "a",
    harness: "codex",
    model: "codex:x",
    modelSettings: {},
    unknownLimit: "use",
  } as const;
  expect([signals.available(entry), signals.signedIn(entry), signals.quota(entry)]).toEqual([
    true,
    true,
    { unknown: true },
  ]);
});
