import { processConstructions } from "../../../integrations/harness/providers/processConstruction.testSupport";
import { beforeEach, describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  live: 0,
  maxLive: 0,
  spawned: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({
  homeDir: async () => "/home/test",
}));
beforeEach(() => processConstructions.reset());
vi.mock("../../../integrations/harness/core/child", () => ({
  ...processConstructions.mock({
    resolveCodexBinary: async () => ({ path: "/bin/codex" }),
    spawnChild: async (
      _id: string,
      _path: string,
      _args: string[],
      _cwd: string,
      account: { id: string },
    ) => {
      child.live += 1;
      child.maxLive = Math.max(child.maxLive, child.live);
      child.spawned.push(account.id);
    },
    watchChild: () => undefined,
    unwatchChild: () => {
      child.live = Math.max(0, child.live - 1);
    },
    killChild: async () => undefined,
  }),
  createChildProcessHandle: vi.fn((sessionId: string) => processConstructions.create(sessionId)),
}));
vi.mock("../../../integrations/harness/core/jsonRpc", () => ({
  JsonRpcClient: class {
    constructor(handle: import("../../../integrations/harness/core/child").ChildProcessHandle) {
      processConstructions.client(handle);
    }
    close() {}
    pushLine() {}
    respond() {
      return Promise.resolve();
    }
    notify() {
      return Promise.resolve();
    }
    async request(method: string) {
      if (method === "account/rateLimitResetCredit/consume") return { outcome: "reset" };
      if (method !== "account/rateLimits/read") return {};
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        rateLimits: {
          primary: { usedPercent: 10, windowDurationMins: 300 },
        },
      };
    }
  },
}));

import { createChildProcessHandle } from "../../../integrations/harness/core/child";
import { consumeCodexRateLimitResetCredit, fetchCodexRateLimits } from "./rateLimitsFetch";

describe("fetchCodexRateLimits", () => {
  beforeEach(() => {
    child.live = 0;
    child.maxLive = 0;
    child.spawned = [];
    vi.mocked(createChildProcessHandle).mockClear();
  });

  it("requests native management authority for usage reads", async () => {
    await fetchCodexRateLimits("account-work");

    expect(createChildProcessHandle).toHaveBeenCalledWith(
      "bycoda-codex-usage",
      undefined,
      "management",
    );
  });

  it("requests native management authority for reset credit consumption", async () => {
    await expect(consumeCodexRateLimitResetCredit("credit-1", "account-work")).resolves.toBe(
      "reset",
    );

    expect(createChildProcessHandle).toHaveBeenCalledWith(
      "bycoda-codex-usage",
      undefined,
      "management",
    );
  });

  it("runs usage probes for different accounts one at a time", async () => {
    const results = await Promise.all([
      fetchCodexRateLimits("default"),
      fetchCodexRateLimits("account-work"),
      fetchCodexRateLimits("account-personal"),
    ]);

    expect(child.maxLive).toBe(1);
    expect(child.spawned).toEqual(["default", "account-work", "account-personal"]);
    expect(results.map((result) => result.session?.usedPercent)).toEqual([10, 10, 10]);
    expect(processConstructions.created).toHaveLength(3);
    expect(new Set(processConstructions.created).size).toBe(3);
    for (const original of processConstructions.created) {
      for (const kind of ["client", "watch", "spawn", "unwatch", "kill"] as const) {
        expect(
          processConstructions.operations.filter(
            (operation) => operation.kind === kind && operation.handle === original,
          ),
        ).toHaveLength(1);
      }
    }
  });
});
