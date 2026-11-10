import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  spawn: vi.fn(),
  kill: vi.fn(),
  close: vi.fn(),
  unwatch: vi.fn(),
  create: vi.fn(() => ({ sessionId: "grok-usage" })),
}));
vi.mock("../../../platform/tauri/fs", () => ({ homeDir: async () => "/home/test" }));
vi.mock("../../../integrations/harness/core/child", () => ({
  createChildProcessHandle: mocks.create,
  resolveGrokBinary: async () => ({ path: "/bin/grok" }),
  spawnChild: mocks.spawn,
  killChild: mocks.kill,
  watchChild: vi.fn(),
  unwatchChild: mocks.unwatch,
}));
vi.mock("../../../integrations/harness/core/jsonRpc", () => ({
  JsonRpcClient: class {
    request = mocks.request;
    close = mocks.close;
    pushLine() {}
    respondError = vi.fn(async () => undefined);
  },
}));
vi.mock("../../../integrations/harness/providers/grok/grokProtocol", () => ({
  grokSpawnArgs: () => ["agent", "stdio"],
}));

import { fetchGrokRateLimits, parseGrokBilling } from "./grokRateLimitsFetch";

const billing = {
  config: {
    creditUsagePercent: 19,
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-11-03T22:41:33.420+00:00",
      end: "2026-11-10T22:41:33.420+00:00",
    },
  },
};

describe("Grok quota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.kill.mockResolvedValue(undefined);
    mocks.spawn.mockResolvedValue(undefined);
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "initialize") return { authMethods: [{ id: "cached_token" }] };
      if (method === "_x.ai/billing") return billing;
      return {};
    });
  });

  it("reads used percentage and exact weekly reset from the provider billing period", () => {
    expect(parseGrokBilling(billing)).toMatchObject({
      provider: "grok",
      status: "ok",
      session: null,
      monthly: null,
      weekly: {
        usedPercent: 19,
        windowMinutes: 10080,
        resetsAt: Date.parse(billing.config.currentPeriod.end),
      },
    });
  });

  it("keeps zero distinct from missing or invalid data", () => {
    expect(
      parseGrokBilling({ config: { ...billing.config, creditUsagePercent: 0 } }).weekly
        ?.usedPercent,
    ).toBe(0);
    for (const value of [
      null,
      {},
      { config: {} },
      { config: { ...billing.config, creditUsagePercent: "19" } },
    ]) {
      expect(parseGrokBilling(value)).toMatchObject({ status: "error", weekly: null });
    }
  });

  it("does not guess quota windows for unknown periods", () => {
    expect(
      parseGrokBilling({ config: { ...billing.config, currentPeriod: { type: "unknown" } } })
        .status,
    ).toBe("error");
  });

  it("keeps monthly duration from its actual period and clamps overrun", () => {
    expect(
      parseGrokBilling({
        config: {
          creditUsagePercent: 110,
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_MONTHLY",
            start: "2026-10-01T00:00:00Z",
            end: "2026-11-01T00:00:00Z",
          },
        },
      }).monthly,
    ).toEqual({
      usedPercent: 100,
      windowMinutes: 44640,
      resetsAt: Date.parse("2026-11-01T00:00:00Z"),
    });
  });

  it("uses headless cached authentication and billing only, then stops captured management process", async () => {
    expect((await fetchGrokRateLimits()).weekly?.usedPercent).toBe(19);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.stringContaining("bycoda-grok-usage"),
      undefined,
      "management",
    );
    expect(mocks.request.mock.calls.map(([method]) => method)).toEqual([
      "initialize",
      "authenticate",
      "_x.ai/billing",
    ]);
    expect(mocks.request).toHaveBeenCalledWith(
      "authenticate",
      { methodId: "cached_token", _meta: { headless: true } },
      12000,
    );
    expect(mocks.kill).toHaveBeenCalledWith(mocks.create.mock.results[0].value);
  });

  it("does not open browser login when cached authentication is absent", async () => {
    mocks.request.mockResolvedValue({ authMethods: [{ id: "grok.com" }] });
    expect((await fetchGrokRateLimits()).status).toBe("unavailable");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.kill).toHaveBeenCalledOnce();
  });

  it("reports upstream failure and still tears down", async () => {
    mocks.request.mockRejectedValue(new Error("billing failed"));
    expect(await fetchGrokRateLimits()).toMatchObject({ status: "error", error: "billing failed" });
    expect(mocks.kill).toHaveBeenCalledOnce();
  });

  it("stops before billing when cached authentication fails", async () => {
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "initialize") return { authMethods: [{ id: "cached_token" }] };
      throw new Error("Authentication required");
    });
    expect((await fetchGrokRateLimits()).status).toBe("unavailable");
    expect(mocks.request.mock.calls.map(([method]) => method)).toEqual([
      "initialize",
      "authenticate",
    ]);
    expect(mocks.kill).toHaveBeenCalledOnce();
  });

  it("retires the original handle when spawn fails", async () => {
    mocks.spawn.mockRejectedValueOnce(new Error("could not spawn Grok"));
    expect((await fetchGrokRateLimits()).status).toBe("error");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.kill).toHaveBeenCalledWith(mocks.create.mock.results[0].value);
    expect(mocks.unwatch).toHaveBeenCalledOnce();
  });

  it("coalesces simultaneous probes", async () => {
    await Promise.all([fetchGrokRateLimits(), fetchGrokRateLimits()]);
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });
});
