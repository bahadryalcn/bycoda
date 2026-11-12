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
import { invoke } from "@tauri-apps/api/core";
import {
  consumeClaudeLimitReset,
  consumeCodexRateLimitResetCredit,
  fetchCodexRateLimits,
} from "./rateLimitsFetch";

describe("consumeClaudeLimitReset", () => {
  const answer = (result: string) =>
    vi.mocked(invoke).mockResolvedValueOnce({ status: "ok", body: JSON.stringify({ result }) });
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("spends the grant behind a row id and maps the server result", async () => {
    answer("reset");
    await expect(consumeClaudeLimitReset("full-reset-2611:0", "account-work")).resolves.toBe(
      "reset",
    );
    expect(invoke).toHaveBeenCalledWith("consume_claude_limit_reset", {
      accountId: "account-work",
      grantId: "full-reset-2611",
      requestId: expect.stringMatching(/^[A-Za-z0-9_-]{1,64}$/),
    });
    answer("not_limited");
    await expect(consumeClaudeLimitReset("g:0")).resolves.toBe("nothingToReset");
    answer("already_used");
    await expect(consumeClaudeLimitReset("g:1")).resolves.toBe("alreadyRedeemed");
  });

  it("never reports an unconfirmed or refused reset as used", async () => {
    answer("cooldown");
    await expect(consumeClaudeLimitReset("g:0")).rejects.toThrow(/Another reset was just used/);
    answer("something-new");
    await expect(consumeClaudeLimitReset("g:0")).rejects.toThrow(/Could not confirm/);
    vi.mocked(invoke).mockResolvedValueOnce({ status: "error", error: "Claude sign-in expired" });
    await expect(consumeClaudeLimitReset("g:0")).rejects.toThrow("Claude sign-in expired");
    await expect(consumeClaudeLimitReset(undefined)).rejects.toThrow(/no id/);
    await expect(consumeClaudeLimitReset("no-index")).rejects.toThrow(/no id/);
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});

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
