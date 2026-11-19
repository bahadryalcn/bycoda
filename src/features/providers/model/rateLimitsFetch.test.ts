import { processConstructions } from "../../../integrations/harness/providers/processConstruction.testSupport";
import { beforeEach, describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  live: 0,
  maxLive: 0,
  spawned: [] as string[],
  /** What the fake app-server does when asked for rate limits / the account. */
  readError: null as Error | null,
  account: {} as unknown,
  resolveError: null as Error | null,
  methods: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({
  homeDir: async () => "/home/test",
}));
beforeEach(() => processConstructions.reset());
vi.mock("../../../integrations/harness/core/child", () => ({
  ...processConstructions.mock({
    resolveCodexBinary: async () => {
      if (child.resolveError) throw child.resolveError;
      return { path: "/bin/codex" };
    },
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
vi.mock("../../../integrations/harness/core/jsonRpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../integrations/harness/core/jsonRpc")>()),
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
      child.methods.push(method);
      if (method === "account/rateLimitResetCredit/consume") return { outcome: "reset" };
      if (method === "account/read") return child.account;
      if (method !== "account/rateLimits/read") return {};
      if (child.readError) throw child.readError;
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
import { JsonRpcResponseError } from "../../../integrations/harness/core/jsonRpc";
import { invoke } from "@tauri-apps/api/core";
import {
  consumeClaudeLimitReset,
  consumeCodexRateLimitResetCredit,
  fetchClaudeRateLimits,
  fetchCodexRateLimits,
  fetchOpencodeGoRateLimits,
} from "./rateLimitsFetch";
import { providerAccountSignedOut } from "./accountUsage";

describe("usage sign-in classification", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("reads Claude sign-out from structured status, not from the message", async () => {
    // No readable credential: the native command answers `unavailable` without an HTTP status.
    vi.mocked(invoke).mockResolvedValueOnce({ status: "unavailable", error: "Fake gateway text" });
    const missing = await fetchClaudeRateLimits("account-work");
    expect(missing).toMatchObject({ status: "unavailable", reason: "signedOut" });
    expect(providerAccountSignedOut(missing)).toBe(true);
    // The provider rejected the token: HTTP 401, worded however the command words it.
    vi.mocked(invoke).mockResolvedValueOnce({
      status: "error",
      httpStatus: 401,
      error: "Please log in again",
    });
    expect(providerAccountSignedOut(await fetchClaudeRateLimits("account-work"))).toBe(true);
  });

  it("does not call unrelated Claude failures signed out, even with auth words in the text", async () => {
    for (const failure of [
      { status: "error", httpStatus: 403, error: "Claude usage is unavailable for this account" },
      { status: "error", httpStatus: 407, error: "Proxy authentication required" },
      { status: "error", httpStatus: 502, error: "Sign-in expired at the gateway" },
      { status: "error", error: "Claude usage request failed: certificate has expired" },
      { status: "error", error: "Account identity changed while reading quota" },
      { status: "renewal_pending", error: "Claude sign-in will renew" },
    ]) {
      vi.mocked(invoke).mockResolvedValueOnce(failure);
      const limits = await fetchClaudeRateLimits("account-work");
      expect(limits.reason, failure.error).toBeUndefined();
      expect(providerAccountSignedOut(limits), failure.error).toBe(false);
    }
  });

  it("separates an OpenCode Go key problem from a missing subscription", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ status: "unavailable", error: "No key" });
    expect(providerAccountSignedOut(await fetchOpencodeGoRateLimits())).toBe(true);
    vi.mocked(invoke).mockResolvedValueOnce({
      status: "error",
      httpStatus: 401,
      error: "Key rejected",
    });
    expect(providerAccountSignedOut(await fetchOpencodeGoRateLimits())).toBe(true);
    vi.mocked(invoke).mockResolvedValueOnce({
      status: "unavailable",
      httpStatus: 403,
      error: "OpenCode Go not connected",
    });
    expect(providerAccountSignedOut(await fetchOpencodeGoRateLimits())).toBe(false);
  });
});

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
    child.readError = null;
    child.account = {};
    child.resolveError = null;
    child.methods = [];
    vi.mocked(createChildProcessHandle).mockClear();
  });

  it("marks Codex signed out only when the app-server refuses and the account needs a login", async () => {
    child.readError = new JsonRpcResponseError("Fake refusal wording", -32600);
    child.account = { account: null, requiresOpenaiAuth: true };
    const limits = await fetchCodexRateLimits("account-work");
    expect(limits).toMatchObject({ status: "unavailable", reason: "signedOut" });
    // The follow-up read stays on the same account's probe.
    expect(child.methods.filter((method) => method === "account/read")).toHaveLength(1);
    expect(child.spawned).toEqual(["account-work", "account-work"]);
  });

  it("keeps a Codex refusal an ordinary failure while the account still has a login", async () => {
    child.readError = new JsonRpcResponseError("authentication expired (proxy)", -32600);
    child.account = { account: { type: "chatgpt" }, requiresOpenaiAuth: true };
    const limits = await fetchCodexRateLimits("account-work");
    expect(limits).toMatchObject({ status: "error", error: "authentication expired (proxy)" });
    expect(providerAccountSignedOut(limits)).toBe(false);
  });

  it("does not ask the account about a probe failure that is not an app-server refusal", async () => {
    child.readError = new Error("Codex usage probe timed out: not signed in");
    const limits = await fetchCodexRateLimits("account-work");
    expect(limits.status).toBe("error");
    expect(providerAccountSignedOut(limits)).toBe(false);
    expect(child.methods).not.toContain("account/read");
  });

  it("reports a missing Codex binary as a missing CLI, which sign-in cannot fix", async () => {
    child.resolveError = new Error("fake lookup failure");
    const limits = await fetchCodexRateLimits("account-work");
    expect(limits).toMatchObject({ status: "unavailable", reason: "cliMissing" });
    expect(providerAccountSignedOut(limits)).toBe(false);
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
