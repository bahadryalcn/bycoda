import { expect, it, vi } from "vitest";
import { ConversationDesktopRelay } from "../conversation/conversation-desktop-relay";
import type { McpHub } from "../mcp/hub/hub";
import { dispatchConversationTools } from "./tools-conversation";

let counter = 0;
const definition = (name: string) => ({
  name,
  source: "user" as const,
  sources: ["claude"],
  aliases: [],
  kind: "stdio" as const,
  command: "node",
});
const tools = [
  { name: "read", annotations: { readOnlyHint: true } },
  { name: "write", annotations: {} },
];

function setup(options: { runtimeMode?: string; modelSettings?: Record<string, string> } = {}) {
  // The crew gate caches a profile per session id.
  const principal = {
    kind: "session" as const,
    projectId: "project",
    sessionId: `s${++counter}`,
    provider: "codex",
  };
  const inventory = vi.fn(async () => [definition("fs"), definition("other")]);
  const hub = {
    inventory,
    peek: vi.fn(async () => ({ tools })),
    request: vi.fn(async () => ({
      jsonrpc: "2.0",
      id: "1",
      result: { content: [{ type: "text", text: "ok" }] },
    })),
    loadingPolicy: async () => ({ version: 1, mode: "onDemand", direct: [] }),
  };
  const relay = new ConversationDesktopRelay("host");
  let live = true;
  const dependencies = {
    conversationAccess: {
      authorization: () => ({}),
      principalForToken: async () => (live ? principal : undefined),
    },
    engine: {
      store: {
        db: { withAuthorization: async (_scope: unknown, run: () => Promise<unknown>) => run() },
        project: async () => ({ cwd: "/project" }),
        session: async () => ({ session: { modelSettings: options.modelSettings } }),
      },
    },
    conversationDesktop: relay,
    inHost: async () => !!options.modelSettings,
    conversationDelegation: { isChild: async () => false },
    featureMeta: async () => ({
      session: {
        runtimeMode: options.runtimeMode ?? "supervised",
        modelSettings: options.modelSettings,
      },
    }),
    mcpHub: hub as unknown as McpHub,
  };
  const dispatch = async (action: string, input: Record<string, unknown>) => {
    const request = {
      conversationPrincipal: principal,
      params: { action, input },
      token: "token",
      tokenHash: "hash",
      endResult: vi.fn(async () => undefined),
      result: undefined as unknown,
    };
    await dispatchConversationTools(dependencies as never, request as never);
    return request.result as { data: any };
  };
  return { hub, relay, dispatch, principal, revoke: () => (live = false) };
}

const write = { server: "fs", tool: "write", arguments: {}, requestId: "r1" };

it("lists servers with the session's project folder and honors the crew allowlist", async () => {
  const { hub, dispatch } = setup({
    modelSettings: { crewTools: JSON.stringify({ preset: "code", mcpServers: ["fs"] }) },
  });
  const result = await dispatch("mcp.servers.list", {});
  expect(hub.inventory).toHaveBeenCalledWith("/project");
  expect(result.data.servers.map((server: { name: string }) => server.name)).toEqual(["fs"]);
  await expect(dispatch("mcp.servers.describe", { server: "other" })).rejects.toThrow(
    "Unknown MCP server.",
  );
});

it("calls a read-only tool without asking and rejects unknown input fields", async () => {
  const { hub, dispatch } = setup();
  const result = await dispatch("mcp.tools.call", { ...write, tool: "read" });
  expect(result.data).toMatchObject({ server: "fs", tool: "read", text: "ok" });
  expect(hub.request).toHaveBeenCalledOnce();
  await expect(
    dispatch("mcp.tools.call", { ...write, tool: "read", requestId: "r2", sessionId: "forged" }),
  ).rejects.toThrow();
});

it("denies a write without a desktop and runs it for Host-verified full-access", async () => {
  const denied = setup();
  await expect(denied.dispatch("mcp.tools.call", write)).rejects.toThrow(
    /owner approval needs the bycoda desktop/,
  );
  expect(denied.hub.request).not.toHaveBeenCalled();

  const full = setup({ runtimeMode: "full-access" });
  const result = await full.dispatch("mcp.tools.call", write);
  expect(result.data).toMatchObject({ tool: "write", text: "ok" });
});

it("sends the native approval dialog request and runs after the owner approves", async () => {
  const { relay, hub, dispatch, principal } = setup();
  await relay.take("native");
  const pending = dispatch("mcp.tools.call", { ...write, arguments: { path: "a" } });
  let delivered: Record<string, unknown>[] = [];
  await vi.waitFor(async () => {
    delivered = await relay.take("native");
    expect(delivered).toHaveLength(1);
  });
  expect(delivered[0]).toMatchObject({
    action: "mcp.call.authorize",
    sessionId: principal.sessionId,
    cwd: "/project",
    input: { server: "fs", tool: "write", arguments: '{"path":"a"}' },
  });
  expect(await relay.authorize(String(delivered[0].id), "mcp.call.authorize", "native")).toEqual({
    authorized: true,
  });
  await relay.finish(String(delivered[0].id), { approved: true }, undefined, "native");
  expect((await pending).data).toMatchObject({ text: "ok" });
  expect(hub.request).toHaveBeenCalledOnce();
  relay.close();
});

it("rejects a revoked credential", async () => {
  const { dispatch, revoke } = setup();
  revoke();
  await expect(dispatch("mcp.servers.list", {})).rejects.toThrow();
});

it("applies the crew tool allowlist before any MCP effect", async () => {
  const { hub, dispatch } = setup({
    modelSettings: {
      crewTools: JSON.stringify({ preset: "code", conversationTools: ["mcp.servers.list"] }),
    },
  });
  await dispatch("mcp.servers.list", {});
  await expect(dispatch("mcp.tools.call", { ...write, tool: "read" })).rejects.toThrow();
  expect(hub.request).not.toHaveBeenCalled();
});
