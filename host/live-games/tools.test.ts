import { describe, expect, it, vi } from "vitest";
import {
  LiveGamesStatusSchema,
  type LiveGamesReport,
} from "../../src/shared/model/host-contracts/live-games";
import {
  callLiveGamesConversationTool,
  requestLiveGamesStreamApproval,
} from "./tools";
import { externalMcpCatalog, managedMcpCatalog, mcpCatalog } from "../mcp/mcp-http";
import { validateSessionConversationTool } from "../conversation/conversation-tools";

const totals = { diamonds: 50, gifts: 1, comments: 0, likes: 0, joins: 1, follows: 0, peakViewers: 3 };
const avatarUrl = "http://127.0.0.1:3776/live-games/overlay-token/avatars/test";
const gifter = { id: "one", name: "Viewer", diamonds: 50, avatarUrl };
const status = LiveGamesStatusSchema.parse({
  connection: { platform: "demo", channel: "Demo", status: "connected", attempts: 0 },
  config: {
    joinKeywords: ["halay"], joinOnAnyComment: false, joinOnLike: true, joinOnFollow: true,
    capacity: 120, leaderHoldSeconds: 90, frontHoldSeconds: 60, giftRules: [], blocked: [],
    shortNames: false,
  },
  snapshot: {
    dancers: [{ ...gifter, role: "leader", handle: "viewer" }], tempo: 2, viewers: 3,
    totals, topGifters: [gifter], feed: [],
  },
  overlayUrl: "http://127.0.0.1:3776/live-games/overlay-token",
  obs: { configured: true, streaming: false, scene: "Bycoda Halay" },
  eulerKeyConfigured: true,
  events: [],
});
const report: LiveGamesReport = {
  channel: "Demo", platform: "demo", startedAt: 1, totals, topGifters: [gifter],
};

function setup() {
  const service = {
    status: vi.fn(async () => status), report: vi.fn(async () => report),
    start: vi.fn(async () => status), stop: vi.fn(async () => status),
    demo: vi.fn(async () => status), setRules: vi.fn(async () => status),
    setConfig: vi.fn(async () => status), obsSetup: vi.fn(async () => status),
    obsScene: vi.fn(async () => status), obsStream: vi.fn(async () => status),
  };
  const authorized = vi.fn(async () => true);
  const approve = vi.fn(async () => {});
  const call = (action: Parameters<typeof callLiveGamesConversationTool>[1], input = {}) =>
    callLiveGamesConversationTool(service, action, input, authorized, approve);
  return { service, authorized, approve, call };
}

describe("Live games Conversation Tools", () => {
  it("uses standard names, schema and authorization without exposing credential actions", () => {
    const catalog = mcpCatalog("conversation").filter((tool) => tool.action.startsWith("liveGames."));
    expect(catalog).toHaveLength(10);
    expect(catalog.find((tool) => tool.action === "liveGames.status")).toMatchObject({
      name: "conversation_liveGames_status",
      annotations: { readOnlyHint: true },
    });
    expect(catalog.map((tool) => tool.action)).not.toContain("liveGames.obsCredentials");
    expect(catalog.map((tool) => tool.action)).not.toContain("liveGames.eulerKey");
    expect(
      externalMcpCatalog("conversation", {
        id: "grant", name: "External MCP", projectId: "p", createdAt: 1, expiresAt: 2,
        scopes: { conversation: ["read", "write"] },
      }).some((tool) => tool.action.startsWith("liveGames.")),
    ).toBe(false);
    expect(() => validateSessionConversationTool("liveGames.start", { channel: "test" })).not.toThrow();
    expect(() => validateSessionConversationTool("liveGames.start", { channel: "test", projectId: "override" })).toThrow();
    expect(() => validateSessionConversationTool("liveGames.obsStream", { action: "send" })).toThrow();
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
    await expect(call("liveGames.obsStream", { action: "start" })).rejects.toThrow("Session authority revoked.");
    expect(service.obsStream).not.toHaveBeenCalled();
    authorized.mockResolvedValue(true);
    await call("liveGames.obsStream", { action: "stop" });
    expect(approve).toHaveBeenCalledOnce();
    expect(service.obsStream).toHaveBeenCalledWith("stop", expect.any(Function));
  });

  it("requires the native reply to match the approved OBS operation", async () => {
    const call = vi.fn(async () => ({ approved: true, operationHash: "wrong" }));
    const principal = { kind: "session" as const, sessionId: "s", projectId: "p", provider: "codex" };
    await expect(
      requestLiveGamesStreamApproval({ call, callAssistantThread: vi.fn() }, "C:/project", principal, status, async () => true),
    ).rejects.toThrow("The owner did not approve starting the OBS broadcast.");
    expect(call).toHaveBeenCalledWith("management.write.authorize", {
      operation: {
        action: "liveGames.obsStream", operationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        input: { action: "start", scene: "Bycoda Halay" },
      },
      requireOwnerApproval: true,
    }, "C:/project", principal, expect.any(Function));
  });
});
