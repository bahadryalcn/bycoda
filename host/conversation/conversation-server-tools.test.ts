import { describe, expect, it } from "vitest";
import { conversationToolCatalog, validateConversationTool } from "./conversation-tools";

describe("saved Servers MCP boundary", () => {
  it("exposes session-owned terminal creation and close without route or confirmation overrides", () => {
    expect(() =>
      validateConversationTool("terminals.create", { requestId: "request-1" }),
    ).not.toThrow();
    expect(() => validateConversationTool("terminals.create", { requestId: "bad/id" })).toThrow();
    expect(() =>
      validateConversationTool("terminals.create", {
        requestId: "request",
        cwd: "/other",
      }),
    ).toThrow();
    expect(() =>
      validateConversationTool("terminals.close", {
        terminalId: "own",
        force: true,
      }),
    ).toThrow();
    expect(() =>
      validateConversationTool("terminals.interrupt", { terminalId: "own" }),
    ).not.toThrow();
    expect(() =>
      validateConversationTool("terminals.interrupt", {
        terminalId: "own",
        data: "arbitrary",
      }),
    ).toThrow();
    expect(() =>
      validateConversationTool("terminals.interrupt", {
        terminalId: "own",
        force: true,
      }),
    ).toThrow();
    for (const action of ["terminals.create", "terminals.close", "terminals.interrupt"])
      expect(
        conversationToolCatalog().find((tool) => tool.action === action)?.annotations.readOnlyHint,
      ).toBe(false);
  });
  it("distinguishes saved inventory from dev servers and advertises only reads as read-only", () => {
    for (const action of ["servers.list", "servers.get", "servers.ssh.status", "devServers.logs"])
      expect(
        conversationToolCatalog().find((tool) => tool.action === action)?.annotations.readOnlyHint,
      ).toBe(true);
    for (const action of [
      "servers.ssh.save",
      "servers.ssh.execute",
      "servers.ssh.cancel",
      "servers.ssh.remove",
      "servers.metadata.update",
      "servers.ssh.identity.set",
      "servers.activity.bookmark",
      "devServers.kill",
      "devServers.openExternal",
    ])
      expect(
        conversationToolCatalog().find((tool) => tool.action === action)?.annotations.readOnlyHint,
      ).toBe(false);
  });
  it("binds SSH commands to saved targets and bounded session-owned operation identities", () => {
    const input = {
      id: "ssh-build",
      requestId: "inspect_1",
      command: "uname -a",
    };
    expect(() => validateConversationTool("servers.ssh.execute", input)).not.toThrow();
    for (const extra of [
      { approved: true },
      { fullAccess: true },
      { runtimeMode: "full-access" },
      { endpoint: { host: "other", port: 22 } },
      { sessionId: "other" },
      { identityFile: "/other" },
      { force: true },
      { timeoutSeconds: 0 },
      { timeoutSeconds: 301 },
      { requestId: "../other" },
      { command: "" },
      { command: "x".repeat(16385) },
    ])
      expect(() =>
        validateConversationTool("servers.ssh.execute", { ...input, ...extra }),
      ).toThrow();
    expect(() =>
      validateConversationTool("servers.ssh.status", {
        requestId: "inspect_1",
        offset: 0,
        maxBytes: 65536,
      }),
    ).not.toThrow();
    for (const extra of [
      { offset: -1 },
      { maxBytes: 0 },
      { maxBytes: 65537 },
      { sessionId: "other" },
    ])
      expect(() =>
        validateConversationTool("servers.ssh.status", {
          requestId: "inspect_1",
          ...extra,
        }),
      ).toThrow();
    expect(() =>
      validateConversationTool("servers.ssh.cancel", {
        requestId: "inspect_1",
      }),
    ).not.toThrow();
    expect(() =>
      validateConversationTool("servers.ssh.cancel", {
        requestId: "inspect_1",
        force: true,
      }),
    ).toThrow();
  });
  it("accepts public SSH metadata but rejects credential material and identity overrides", () => {
    const input = {
      name: "Build machine",
      endpoint: {
        host: "build.local",
        port: 22,
        identityFile: "C:/keys/build",
        jumpPolicies: [{ host: "jump.local", port: 22 }],
      },
    };
    expect(() => validateConversationTool("servers.ssh.save", input)).not.toThrow();
    for (const extra of [
      { password: "secret" },
      { token: "secret" },
      { privateKey: "secret" },
      { approved: true },
      { fullAccess: true },
      { runtimeMode: "full-access" },
    ])
      expect(() =>
        validateConversationTool("servers.ssh.save", {
          ...input,
          endpoint: { ...input.endpoint, ...extra },
        }),
      ).toThrow();
    expect(() =>
      validateConversationTool("servers.ssh.save", {
        ...input,
        machineId: "other",
      }),
    ).toThrow();
    expect(() => validateConversationTool("servers.list", { limit: 101 })).toThrow();
    expect(() =>
      validateConversationTool("servers.ssh.save", {
        ...input,
        endpoint: { host: "build", port: 0 },
      }),
    ).toThrow();
  });
  it("allows explicit clearing and restricts organization writes to public metadata", () => {
    expect(() =>
      validateConversationTool("servers.ssh.identity.set", {
        id: "ssh",
        identityFile: null,
      }),
    ).not.toThrow();
    expect(() =>
      validateConversationTool("servers.ssh.identity.set", {
        id: "ssh",
        identityFile: 42,
      }),
    ).toThrow();
    expect(() =>
      validateConversationTool("servers.metadata.update", {
        id: "ssh",
        metadata: {
          colorIndex: null,
          customColor: null,
          group: null,
          favorite: true,
        },
      }),
    ).not.toThrow();
    for (const metadata of [
      { customColor: "invalid" },
      { colorIndex: 9 },
      { colorIndex: "2" },
      { activity: [] },
      { sshInheritance: {} },
      { token: "secret" },
    ])
      expect(() =>
        validateConversationTool("servers.metadata.update", {
          id: "ssh",
          metadata,
        }),
      ).toThrow();
  });
  it("requires exact dev-server endpoints and bounded logs without allowing route overrides", () => {
    expect(() =>
      validateConversationTool("devServers.openExternal", {
        id: "dev",
        port: 5173,
      }),
    ).not.toThrow();
    expect(() =>
      validateConversationTool("devServers.openExternal", {
        id: "dev",
        port: 5173,
        url: "https://other",
      }),
    ).toThrow();
    expect(() =>
      validateConversationTool("devServers.logs", {
        id: "dev",
        maxBytes: 32000,
      }),
    ).not.toThrow();
    expect(() =>
      validateConversationTool("devServers.logs", {
        id: "dev",
        maxBytes: 100001,
      }),
    ).toThrow();
    expect(() =>
      validateConversationTool("devServers.kill", {
        id: "dev",
        identity: { pid: 12, startedAt: "start", force: true },
      }),
    ).toThrow();
  });
});
