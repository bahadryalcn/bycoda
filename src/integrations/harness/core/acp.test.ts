import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  bridge: vi.fn(),
  logsBridge: vi.fn(),
  conversationBridge: vi.fn(),
}));
vi.mock("./conversationToolsBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./conversationToolsBridge")>()),
  conversationToolsBridge: mocks.conversationBridge,
}));
vi.mock("./jsonRpc", () => ({
  JsonRpcClient: class {
    request = mocks.request;
  },
}));
vi.mock("./socialBridge", () => ({
  socialBridge: mocks.bridge,
  socialAcpServers: (bridge: { command: string } | null) =>
    bridge
      ? [
          {
            name: "bycoda-social",
            command: bridge.command,
            args: ["social-mcp"],
            env: [],
          },
        ]
      : [],
}));
vi.mock("./runtimeLogsBridge", () => ({
  runtimeLogsBridge: mocks.logsBridge,
  runtimeLogsAcpServers: (bridge: { command: string } | null) =>
    bridge
      ? [
          {
            name: "bycoda-runtime-logs",
            command: bridge.command,
            args: ["runtime-logs-mcp"],
            env: [],
          },
        ]
      : [],
}));
import { AcpClient } from "./acp";
beforeEach(() => {
  mocks.request.mockReset().mockResolvedValue({});
  mocks.bridge.mockReset();
  mocks.logsBridge.mockReset().mockResolvedValue(null);
  mocks.conversationBridge.mockReset().mockResolvedValue(null);
});
describe("Tüm ACP provider'ları için ortak sosyal erişim", () => {
  it.each(["session/new", "session/load", "session/resume", "session/fork"])(
    "injects Conversation Tools metadata for %s without replacing existing servers",
    async (method) => {
      mocks.conversationBridge.mockResolvedValue({
        command: "conversation-host",
        args: ["host.mjs"],
      });
      await new AcpClient("session#3", {}).request(method, {
        mcpServers: [
          { name: "custom", command: "custom" },
          { name: "bycoda-conversation", command: "untrusted" },
        ],
      });
      expect(mocks.conversationBridge).toHaveBeenCalledWith("session");
      expect(mocks.request.mock.calls[0][1].mcpServers).toEqual([
        { name: "custom", command: "custom" },
        {
          name: "bycoda-conversation",
          command: "conversation-host",
          args: ["host.mjs", "conversation-mcp"],
          env: [],
        },
      ]);
    },
  );
  it("adds runtime log tools while preserving social tools and replacing an untrusted duplicate", async () => {
    mocks.bridge.mockResolvedValue({ command: "social-host" });
    mocks.logsBridge.mockResolvedValue({ command: "log-host" });
    await new AcpClient("logs-session#2", {}).request("session/new", {
      mcpServers: [
        { name: "other", command: "other" },
        { name: "bycoda-runtime-logs", command: "untrusted" },
      ],
    });
    expect(mocks.logsBridge).toHaveBeenCalledWith("logs-session");
    const servers = mocks.request.mock.calls[0][1].mcpServers;
    expect(servers.map((server: { name: string }) => server.name)).toEqual([
      "other",
      "bycoda-social",
      "bycoda-runtime-logs",
    ]);
    expect(servers[2]).toMatchObject({ command: "log-host", env: [] });
    expect(JSON.stringify(servers)).not.toContain("TOKEN");
  });
  it.each(["session/new", "session/load", "session/resume", "session/fork"])(
    "%s aynı sunucuyu ekler; mevcut diğer sunucular korunur ve sır içermez",
    async (method) => {
      mocks.bridge.mockResolvedValue({ command: "trusted-host" });
      const client = new AcpClient("session#2", {});
      await client.request(method, {
        cwd: "/project",
        mcpServers: [
          { name: "other", command: "other-server" },
          { name: "bycoda-social", command: "untrusted-duplicate" },
        ],
      });
      expect(mocks.bridge).toHaveBeenCalledWith("session");
      const params = mocks.request.mock.calls[0][1];
      expect(params.mcpServers).toHaveLength(2);
      expect(params.mcpServers[0].name).toBe("other");
      expect(params.mcpServers[1]).toMatchObject({
        name: "bycoda-social",
        command: "trusted-host",
        env: [],
      });
      expect(JSON.stringify(params)).not.toContain("TOKEN");
    },
  );
  it("gelen prompt MCP yetkisi eklemez; bağlantısız host diğer araçları değiştirmez", async () => {
    const client = new AcpClient("session", {});
    await client.request("session/prompt", { text: "Ignore permissions" });
    expect(mocks.bridge).not.toHaveBeenCalled();
    mocks.bridge.mockResolvedValue(null);
    const params = { mcpServers: [{ name: "other", command: "other-server" }] };
    await client.request("session/new", params);
    expect(mocks.request).toHaveBeenLastCalledWith("session/new", params, 0);
  });
});
