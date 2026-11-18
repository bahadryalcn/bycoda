import { describe, expect, it, vi } from "vitest";
import {
  LiveGamesStatusSchema,
  type LiveGamesReport,
} from "../../src/shared/model/host-contracts/live-games";
import { callLiveGamesConversationTool, requestLiveGamesStreamApproval } from "./tools";
import { externalMcpCatalog, managedMcpCatalog, mcpCatalog } from "../mcp/mcp-http";
import { validateSessionConversationTool } from "../conversation/conversation-tools";

const totals = {
  diamonds: 50,
  gifts: 1,
  comments: 0,
  likes: 0,
  joins: 1,
  follows: 0,
  peakViewers: 3,
};
const avatarUrl = "http://127.0.0.1:3776/live-games/overlay-token/avatars/test";
const gifter = { id: "one", name: "Viewer", diamonds: 50, avatarUrl };
const status = LiveGamesStatusSchema.parse({
  connection: { platform: "demo", channel: "Demo", status: "connected", attempts: 0 },
  config: {
    joinKeywords: ["halay"],
    joinOnAnyComment: false,
    joinOnLike: true,
    joinOnFollow: true,
    capacity: 120,
    leaderHoldSeconds: 90,
    frontHoldSeconds: 60,
    giftRules: [],
    blocked: [],
    shortNames: false,
  },
  snapshot: {
    dancers: [{ ...gifter, role: "leader", handle: "viewer" }],
    tempo: 2,
    viewers: 3,
    totals,
    topGifters: [gifter],
    feed: [],
  },
  overlayUrl: "http://127.0.0.1:3776/live-games/overlay-token",
  obs: { configured: true, streaming: false, scene: "Bycoda Halay" },
  eulerKeyConfigured: true,
  events: [],
});
const report: LiveGamesReport = {
  channel: "Demo",
  platform: "demo",
  startedAt: 1,
  totals,
  topGifters: [gifter],
};
const principal = {
  kind: "session" as const,
  sessionId: "s",
  projectId: "p",
  provider: "codex",
};
const account = { accountId: "yt", platform: "youtube" as const, label: "Studio channel" };
const target = {
  ...account,
  binding: { accountId: account.accountId, platform: account.platform, platformId: "channel-1" },
};
const liveStatus = { state: "idle" as const, canStop: false };

function setup() {
  const service = {
    status: vi.fn(async () => status),
    report: vi.fn(async () => report),
    start: vi.fn(async () => status),
    stop: vi.fn(async () => status),
    demo: vi.fn(async () => status),
    setRules: vi.fn(async () => status),
    setConfig: vi.fn(async () => status),
    obsSetup: vi.fn(async () => status),
    obsScene: vi.fn(async () => status),
    obsStream: vi.fn(async () => status),
    liveAccount: vi.fn(async () => target),
    liveAccounts: vi.fn(async () => ({ accounts: [account] })),
    liveStatus: vi.fn(async () => liveStatus),
    liveStart: vi.fn(async () => liveStatus),
    liveStop: vi.fn(async () => liveStatus),
  };
  const authorized = vi.fn(async () => true);
  const approve = vi.fn(async () => {});
  const call = (action: Parameters<typeof callLiveGamesConversationTool>[1], input = {}) =>
    callLiveGamesConversationTool(service, action, input, authorized, approve, principal);
  return { service, authorized, approve, call };
}

describe("Live games Conversation Tools", () => {
  it("uses standard names, schema and authorization without exposing credential actions", () => {
    const catalog = mcpCatalog("conversation").filter((tool) =>
      tool.action.startsWith("liveGames."),
    );
    expect(catalog).toHaveLength(14);
    expect(catalog.find((tool) => tool.action === "liveGames.status")).toMatchObject({
      name: "conversation_liveGames_status",
      annotations: { readOnlyHint: true },
    });
    expect(catalog.map((tool) => tool.action)).not.toContain("liveGames.obsCredentials");
    expect(catalog.map((tool) => tool.action)).not.toContain("liveGames.eulerKey");
    expect(
      externalMcpCatalog("conversation", {
        id: "grant",
        name: "External MCP",
        projectId: "p",
        createdAt: 1,
        expiresAt: 2,
        scopes: { conversation: ["read", "write"] },
      }).some((tool) => tool.action.startsWith("liveGames.")),
    ).toBe(false);
    expect(() =>
      validateSessionConversationTool("liveGames.start", { channel: "test" }),
    ).not.toThrow();
    expect(() =>
      validateSessionConversationTool("liveGames.start", {
        channel: "test",
        projectId: "override",
      }),
    ).toThrow();
    expect(() =>
      validateSessionConversationTool("liveGames.obsStream", { action: "send" }),
    ).toThrow();
    expect(() =>
      validateSessionConversationTool("liveGames.goLive", { accountId: "yt", scene: "Stage" }),
    ).not.toThrow();
    for (const field of ["projectId", "streamKey", "approved"]) {
      expect(() =>
        validateSessionConversationTool("liveGames.goLive", { accountId: "yt", [field]: "forged" }),
      ).toThrow();
    }
  });

  it("provides readback and explicit stops in managed discovery", () => {
    const catalog = managedMcpCatalog();
    expect(catalog.find((tool) => tool.action === "liveGames.start")).toMatchObject({
      supported: true,
      retry: { mode: "read-before-retry" },
      readback: ["conversation:liveGames.status", "conversation:liveGames.report"],
      cancellation: ["conversation:liveGames.stop"],
    });
    expect(catalog.find((tool) => tool.action === "liveGames.obsStream")).toMatchObject({
      authorization: { requirement: "native-owner-approval" },
      effects: ["execution", "external-write"],
      cancellation: ["conversation:liveGames.obsStream"],
    });
    expect(catalog.find((tool) => tool.action === "liveGames.goLive")).toMatchObject({
      authorization: { requirement: "native-owner-approval" },
      effects: ["execution", "external-write"],
      readback: ["conversation:liveGames.liveStatus"],
      cancellation: ["conversation:liveGames.endLive"],
      retry: { instruction: expect.stringContaining("Never automatically retry") },
    });
    expect(catalog.find((tool) => tool.action === "liveGames.liveAccounts")).toMatchObject({
      annotations: { readOnlyHint: true },
    });
  });

  it("omits bearer URLs while returning the scoreboard and report", async () => {
    const { call } = setup();
    const current = await call("liveGames.status");
    const summary = await call("liveGames.report");
    expect(current).toMatchObject({ snapshot: { participants: 1, leader: "Viewer" } });
    expect(summary).toMatchObject({ totals: { diamonds: 50 } });
    expect(JSON.stringify([current, summary])).not.toContain("overlay-token");
  });

  it("requires current authority at action and disclosure boundaries", async () => {
    const { call, authorized, service } = setup();
    authorized.mockResolvedValueOnce(false);
    await expect(call("liveGames.demo")).rejects.toThrow("Session authority revoked.");
    expect(service.demo).not.toHaveBeenCalled();
    service.status.mockImplementationOnce(async () => {
      authorized.mockResolvedValue(false);
      return status;
    });
    await expect(call("liveGames.status")).rejects.toThrow("Session authority revoked.");
  });

  it("never starts OBS after revoked approval and allows a direct stop", async () => {
    const { call, approve, authorized, service } = setup();
    approve.mockImplementationOnce(async () => {
      authorized.mockResolvedValue(false);
    });
    await expect(call("liveGames.obsStream", { action: "start" })).rejects.toThrow(
      "Session authority revoked.",
    );
    expect(service.obsStream).not.toHaveBeenCalled();
    authorized.mockResolvedValue(true);
    await call("liveGames.obsStream", { action: "stop" });
    expect(approve).toHaveBeenCalledOnce();
    expect(service.obsStream).toHaveBeenCalledWith("stop", expect.any(Function));
  });

  it("requires the native reply to match the approved OBS operation", async () => {
    const call = vi.fn(async () => ({ approved: true, operationHash: "wrong" }));
    await expect(
      requestLiveGamesStreamApproval(
        { call, callAssistantThread: vi.fn() },
        "C:/project",
        principal,
        { action: "liveGames.obsStream", input: { action: "start", scene: "Bycoda Halay" } },
        async () => true,
      ),
    ).rejects.toThrow("The owner did not approve starting the OBS broadcast.");
    expect(call).toHaveBeenCalledWith(
      "management.write.authorize",
      {
        operation: {
          action: "liveGames.obsStream",
          operationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          input: { action: "start", scene: "Bycoda Halay" },
        },
        requireOwnerApproval: true,
      },
      "C:/project",
      principal,
      expect.any(Function),
    );
  });

  it("binds the approved Social account and scene to the original session's project", async () => {
    const { call, approve, service } = setup();
    await call("liveGames.goLive", { accountId: "yt" });
    expect(approve).toHaveBeenCalledWith(
      { action: "liveGames.goLive", input: { ...account, scene: "Bycoda Halay" } },
      expect.any(Function),
    );
    expect(service.liveStart).toHaveBeenCalledWith(
      { accountId: "yt", scene: "Bycoda Halay" },
      { ...principal, actorId: "session:s" },
      expect.any(Function),
      target,
    );
    await call("liveGames.endLive");
    expect(approve).toHaveBeenCalledOnce();
    expect(service.liveStop).toHaveBeenCalledWith(
      { ...principal, actorId: "session:s" },
      expect.any(Function),
    );
  });

  it("requires a fresh native reply for each Social broadcast approval", async () => {
    let oldHash: string | undefined;
    const call = vi.fn(async (_action: string, input: Record<string, unknown>) => {
      oldHash ??= (input.operation as { operationHash: string }).operationHash;
      return { approved: true, operationHash: oldHash };
    });
    const desktop = { call, callAssistantThread: vi.fn() };
    const operation = {
      action: "liveGames.goLive" as const,
      input: { ...account, scene: "Stage" },
    };
    const request = () =>
      requestLiveGamesStreamApproval(desktop, "C:/project", principal, operation, async () => true);
    await expect(request()).resolves.toBeUndefined();
    await expect(request()).rejects.toThrow("The owner did not approve");
    expect(call.mock.calls[0]?.[1]).toMatchObject({
      operation: { ...operation, operationHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      requireOwnerApproval: true,
    });
  });

  it("drops a Social start if access changes or the owner declines", async () => {
    const { call, approve, authorized, service } = setup();
    approve.mockRejectedValueOnce(new Error("Owner declined."));
    await expect(call("liveGames.goLive", { accountId: "yt" })).rejects.toThrow("Owner declined.");
    approve.mockImplementationOnce(async () => {
      authorized.mockResolvedValue(false);
    });
    await expect(call("liveGames.goLive", { accountId: "yt" })).rejects.toThrow(
      "Session authority revoked.",
    );
    expect(service.liveStart).not.toHaveBeenCalled();
  });

  it("keeps external platform confirmation on the owner RPC", async () => {
    const { call, service } = setup();
    expect(() =>
      validateSessionConversationTool("liveGames.endLive", { platformEnded: true }),
    ).toThrow();
    await expect(call("liveGames.endLive", { platformEnded: true })).rejects.toThrow();
    expect(service.liveStop).not.toHaveBeenCalled();
  });

  it("validates Social readbacks before returning Host data to the agent", async () => {
    const { call, service } = setup();
    await expect(call("liveGames.liveAccounts")).resolves.toEqual({ accounts: [account] });
    await expect(call("liveGames.liveStatus")).resolves.toEqual(liveStatus);
    const unexpectedAccount = { ...account, streamKey: "sentinel-secret" };
    service.liveAccounts.mockResolvedValueOnce({ accounts: [unexpectedAccount] });
    await expect(call("liveGames.liveAccounts")).rejects.toThrow("Unrecognized key");
    service.liveAccounts.mockResolvedValueOnce({ accounts: [unexpectedAccount] });
    await expect(call("liveGames.liveAccounts")).rejects.not.toThrow("sentinel-secret");
  });

  it("rejects projectless Social starts before asking for approval", async () => {
    const { approve, authorized, service } = setup();
    await expect(
      callLiveGamesConversationTool(
        service,
        "liveGames.goLive",
        { accountId: "yt" },
        authorized,
        approve,
        { kind: "assistant-thread", threadId: "room", environmentId: "host" },
      ),
    ).rejects.toThrow("Social broadcasting requires a project");
    expect(service.liveAccount).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });
});
