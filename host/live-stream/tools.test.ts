import { describe, expect, it, vi } from "vitest";
import {
  LiveStreamStatusSchema,
  type LiveStreamReport,
} from "../../src/shared/model/host-contracts/live-stream";
import { callLiveStreamConversationTool, requestLiveStreamStreamApproval } from "./tools";
import { externalMcpCatalog, managedMcpCatalog, mcpCatalog } from "../mcp/mcp-http";
import { validateSessionConversationTool } from "../conversation/conversation-tools";

const totals = {
  diamonds: 50,
  gifts: 1,
  comments: 0,
  likes: 0,
  comments: 2,
  likes: 3,
  follows: 0,
  peakViewers: 3,
};
const avatarUrl = "https://p16.tiktokcdn.com/avatars/test";
const gifter = { id: "one", name: "Viewer", diamonds: 50, avatarUrl };
const status = LiveStreamStatusSchema.parse({
  connection: { platform: "demo", channel: "Demo", status: "connected", attempts: 0 },
  snapshot: {
    viewers: 3,
    totals,
    topGifters: [gifter],
  },
  obs: { configured: true, streaming: false, scene: "Studio" },
  eulerKeyConfigured: true,
  events: [],
});
const report: LiveStreamReport = {
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
    obsSetup: vi.fn(async () => status),
    obsStream: vi.fn(async () => status),
    liveScene: vi.fn(async (scene?: string) => scene ?? "Studio"),
    liveAccount: vi.fn(async () => target),
    liveAccounts: vi.fn(async () => ({ accounts: [account] })),
    liveStatus: vi.fn(async () => liveStatus),
    liveStart: vi.fn(async () => liveStatus),
    liveStop: vi.fn(async () => liveStatus),
  };
  const authorized = vi.fn(async () => true);
  const approve = vi.fn(async () => {});
  const call = (action: Parameters<typeof callLiveStreamConversationTool>[1], input = {}) =>
    callLiveStreamConversationTool(service, action, input, authorized, approve, principal);
  return { service, authorized, approve, call };
}

describe("Live streaming Conversation Tools", () => {
  it("uses standard names, schema and authorization without exposing credential actions", () => {
    const catalog = mcpCatalog("conversation").filter((tool) =>
      tool.action.startsWith("liveStream."),
    );
    expect(catalog).toHaveLength(11);
    expect(catalog.find((tool) => tool.action === "liveStream.status")).toMatchObject({
      name: "conversation_liveStream_status",
      annotations: { readOnlyHint: true },
    });
    expect(catalog.map((tool) => tool.action)).not.toContain("liveStream.obsCredentials");
    expect(catalog.map((tool) => tool.action)).not.toContain("liveStream.eulerKey");
    expect(
      externalMcpCatalog("conversation", {
        id: "grant",
        name: "External MCP",
        projectId: "p",
        createdAt: 1,
        expiresAt: 2,
        scopes: { conversation: ["read", "write"] },
      }).some((tool) => tool.action.startsWith("liveStream.")),
    ).toBe(false);
    expect(() =>
      validateSessionConversationTool("liveStream.start", { channel: "test" }),
    ).not.toThrow();
    expect(() =>
      validateSessionConversationTool("liveStream.start", {
        channel: "test",
        projectId: "override",
      }),
    ).toThrow();
    expect(() =>
      validateSessionConversationTool("liveStream.obsStream", { action: "send" }),
    ).toThrow();
    expect(() =>
      validateSessionConversationTool("liveStream.goLive", { accountId: "yt", scene: "Stage" }),
    ).not.toThrow();
    for (const field of ["projectId", "streamKey", "approved"]) {
      expect(() =>
        validateSessionConversationTool("liveStream.goLive", {
          accountId: "yt",
          [field]: "forged",
        }),
      ).toThrow();
    }
  });

  it("provides readback and explicit stops in managed discovery", () => {
    const catalog = managedMcpCatalog();
    expect(catalog.find((tool) => tool.action === "liveStream.start")).toMatchObject({
      supported: true,
      retry: { mode: "read-before-retry" },
      readback: ["conversation:liveStream.status", "conversation:liveStream.report"],
      cancellation: ["conversation:liveStream.stop"],
    });
    expect(catalog.find((tool) => tool.action === "liveStream.obsStream")).toMatchObject({
      authorization: { requirement: "native-owner-approval" },
      effects: ["execution", "external-write"],
      cancellation: ["conversation:liveStream.obsStream"],
    });
    expect(catalog.find((tool) => tool.action === "liveStream.goLive")).toMatchObject({
      authorization: { requirement: "native-owner-approval" },
      effects: ["execution", "external-write"],
      readback: ["conversation:liveStream.liveStatus"],
      cancellation: ["conversation:liveStream.endLive"],
      retry: { instruction: expect.stringContaining("Never automatically retry") },
    });
    expect(catalog.find((tool) => tool.action === "liveStream.liveAccounts")).toMatchObject({
      annotations: { readOnlyHint: true },
    });
  });

  it("omits avatar URLs while returning the session totals and report", async () => {
    const { call } = setup();
    const current = await call("liveStream.status");
    const summary = await call("liveStream.report");
    expect(current).toMatchObject({ snapshot: { viewers: 3, totals: { diamonds: 50 } } });
    expect(summary).toMatchObject({ totals: { diamonds: 50 } });
    expect(JSON.stringify([current, summary])).not.toContain("avatars/test");
  });

  it("requires current authority at action and disclosure boundaries", async () => {
    const { call, authorized, service } = setup();
    authorized.mockResolvedValueOnce(false);
    await expect(call("liveStream.demo")).rejects.toThrow("Session authority revoked.");
    expect(service.demo).not.toHaveBeenCalled();
    service.status.mockImplementationOnce(async () => {
      authorized.mockResolvedValue(false);
      return status;
    });
    await expect(call("liveStream.status")).rejects.toThrow("Session authority revoked.");
  });

  it("never starts OBS after revoked approval and allows a direct stop", async () => {
    const { call, approve, authorized, service } = setup();
    approve.mockImplementationOnce(async () => {
      authorized.mockResolvedValue(false);
    });
    await expect(call("liveStream.obsStream", { action: "start" })).rejects.toThrow(
      "Session authority revoked.",
    );
    expect(service.obsStream).not.toHaveBeenCalled();
    authorized.mockResolvedValue(true);
    await call("liveStream.obsStream", { action: "stop" });
    expect(approve).toHaveBeenCalledOnce();
    expect(service.obsStream).toHaveBeenCalledWith("stop", expect.any(Function));
  });

  it("requires the native reply to match the approved OBS operation", async () => {
    const call = vi.fn(async () => ({ approved: true, operationHash: "wrong" }));
    await expect(
      requestLiveStreamStreamApproval(
        { call, callAssistantThread: vi.fn() },
        "C:/project",
        principal,
        { action: "liveStream.obsStream", input: { action: "start", scene: "Studio" } },
        async () => true,
      ),
    ).rejects.toThrow("The owner did not approve starting the OBS broadcast.");
    expect(call).toHaveBeenCalledWith(
      "management.write.authorize",
      {
        operation: {
          action: "liveStream.obsStream",
          operationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          input: { action: "start", scene: "Studio" },
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
    await call("liveStream.goLive", { accountId: "yt" });
    expect(approve).toHaveBeenCalledWith(
      { action: "liveStream.goLive", input: { ...account, scene: "Studio" } },
      expect.any(Function),
    );
    expect(service.liveStart).toHaveBeenCalledWith(
      { accountId: "yt", scene: "Studio" },
      { ...principal, actorId: "session:s" },
      expect.any(Function),
      target,
    );
    await call("liveStream.endLive");
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
      action: "liveStream.goLive" as const,
      input: { ...account, scene: "Stage" },
    };
    const request = () =>
      requestLiveStreamStreamApproval(
        desktop,
        "C:/project",
        principal,
        operation,
        async () => true,
      );
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
    await expect(call("liveStream.goLive", { accountId: "yt" })).rejects.toThrow("Owner declined.");
    approve.mockImplementationOnce(async () => {
      authorized.mockResolvedValue(false);
    });
    await expect(call("liveStream.goLive", { accountId: "yt" })).rejects.toThrow(
      "Session authority revoked.",
    );
    expect(service.liveStart).not.toHaveBeenCalled();
  });

  it("keeps external platform confirmation on the owner RPC", async () => {
    const { call, service } = setup();
    expect(() =>
      validateSessionConversationTool("liveStream.endLive", { platformEnded: true }),
    ).toThrow();
    await expect(call("liveStream.endLive", { platformEnded: true })).rejects.toThrow();
    expect(service.liveStop).not.toHaveBeenCalled();
  });

  it("validates Social readbacks before returning Host data to the agent", async () => {
    const { call, service } = setup();
    await expect(call("liveStream.liveAccounts")).resolves.toEqual({ accounts: [account] });
    await expect(call("liveStream.liveStatus")).resolves.toEqual(liveStatus);
    const unexpectedAccount = { ...account, streamKey: "sentinel-secret" };
    service.liveAccounts.mockResolvedValueOnce({ accounts: [unexpectedAccount] });
    await expect(call("liveStream.liveAccounts")).rejects.toThrow("Unrecognized key");
    service.liveAccounts.mockResolvedValueOnce({ accounts: [unexpectedAccount] });
    await expect(call("liveStream.liveAccounts")).rejects.not.toThrow("sentinel-secret");
  });

  it("rejects projectless Social starts before asking for approval", async () => {
    const { approve, authorized, service } = setup();
    await expect(
      callLiveStreamConversationTool(
        service,
        "liveStream.goLive",
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
