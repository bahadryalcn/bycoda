import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import {
  ConversationDesktopRelay,
  authorizeConversationAcpFrame,
  callConversationTool,
  conversationToolCatalog,
  runConversationMcp,
  validateConversationTool,
} from "./conversation-tools";

const principal = { kind: "session" as const, projectId: "p", sessionId: "s", provider: "codex" };
describe("Conversation Tools boundary", () => {
  it("runs the built CLI and MCP subprocesses through the same scoped RPC contract", async () => {
    const server = createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      const value = JSON.parse(raw);
      if (
        request.headers.authorization !== "Bearer test-session-secret" ||
        value.method !== "conversation.tools.call" ||
        value.environmentId !== "host"
      ) {
        response.writeHead(403).end(JSON.stringify({ error: "Denied" }));
        return;
      }
      response.end(
        JSON.stringify({ result: { action: value.params.action, input: value.params.input } }),
      );
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const env = {
      ...process.env,
      BYCODA_CONVERSATION_TOKEN: "test-session-secret",
      BYCODA_CONVERSATION_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      BYCODA_CONVERSATION_ENVIRONMENT: "host",
    };
    const run = (args: string[], input: string) =>
      new Promise<{ code: number | null; stdout: string }>((done, reject) => {
        const child = spawn(process.execPath, [resolve("build/host/bycoda-host.mjs"), ...args], {
          env,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Conversation CLI timed out"));
        }, 10000);
        child.stdout.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.resume();
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          done({ code, stdout });
        });
        child.stdin.end(input);
      });
    try {
      const cli = await run(["conversation", "tasks.get", "--input", "-"], '{"taskId":"task"}');
      expect(cli.code).toBe(0);
      expect(JSON.parse(cli.stdout)).toEqual({
        ok: true,
        result: { action: "tasks.get", input: { taskId: "task" } },
      });
      const mcp = await run(
        ["conversation-mcp"],
        JSON.stringify({
          id: 1,
          method: "tools/call",
          params: { name: "conversation_devices_list", arguments: { machineId: "mac" } },
        }) + "\n",
      );
      expect(mcp.code).toBe(0);
      expect(JSON.parse(JSON.parse(mcp.stdout).result.content[0].text)).toEqual({
        action: "devices.list",
        input: { machineId: "mac" },
      });
      const denied = await run(
        ["conversation", "tasks.list", "--input", "-"],
        '{"projectId":"foreign"}',
      );
      expect(denied.code).toBe(1);
      expect(JSON.parse(denied.stdout).error).toContain("protected");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
  it("rejects forged identities, permissions, invalid nested device actions and invalid numeric fields", () => {
    for (const [action, input] of [
      ["tasks.list", { projectId: "foreign" }],
      ["devices.list", { endpoint: "https://evil" }],
      ["devices.action", { deviceId: "ios", action: { type: "home", command: "evil" } }],
      ["tasks.update", { taskId: "task", autoMerge: true }],
      ["logs.read", { limit: 501 }],
      ["devices.action", { deviceId: "ios", action: { type: "press", x: NaN, y: 1 } }],
      ["tasks.delete", {}],
      ["devices.setup", { agentAccess: true }],
    ] as const)
      expect(() => validateConversationTool(action, input)).toThrow();
    expect(() =>
      validateConversationTool("devices.action", {
        machineId: "mac",
        deviceId: "ios",
        action: { type: "type", text: "test" },
      }),
    ).not.toThrow();
    expect(
      conversationToolCatalog().find((tool) => tool.action === "terminals.write")?.annotations
        .readOnlyHint,
    ).toBe(false);
  });
  it("fails offline, claims once, binds results to the native owner and never replays writes", async () => {
    const relay = new ConversationDesktopRelay();
    expect(() => relay.call("terminals.list", {}, "/project", principal)).toThrow("offline");
    relay.take("owner");
    const result = relay.call(
      "terminals.write",
      { terminalId: "terminal", data: "pwd\n" },
      "/project",
      principal,
    );
    const requests = relay.take("owner");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      cwd: "/project",
      sessionId: "s",
      action: "terminals.write",
    });
    expect(relay.take("owner")).toEqual([]);
    expect(() => relay.finish(String(requests[0].id), {}, undefined, "other")).toThrow();
    relay.finish(String(requests[0].id), { accepted: true }, undefined, "owner");
    await expect(result).resolves.toEqual({ accepted: true });
    expect(() => relay.finish(String(requests[0].id), {})).toThrow();
    relay.close();
  });
  it("does not deliver revoked or expired queued authority to the desktop", async () => {
    const relay = new ConversationDesktopRelay();
    relay.take();
    let authorized = true;
    const result = relay.call(
      "terminals.write",
      { terminalId: "t", data: "pwd\n" },
      "/p",
      principal,
      () => authorized,
    );
    authorized = false;
    expect(relay.take()).toEqual([]);
    await expect(result).rejects.toThrow("revoked");
    relay.close();
  });
  it("keeps conversation credentials separate from read-only logs and other ACP servers", () => {
    const env = {
      BYCODA_CONVERSATION_TOKEN: "session-secret",
      BYCODA_CONVERSATION_ENDPOINT: "https://host.test",
      BYCODA_CONVERSATION_ENVIRONMENT: "host",
    };
    const raw = JSON.stringify({
      method: "session/new",
      params: {
        mcpServers: [
          {
            name: "bycoda-conversation",
            command: "node",
            env: [{ name: "BYCODA_CONVERSATION_TOKEN", value: "forged" }],
          },
          { name: "bycoda-runtime-logs", command: "node", env: [] },
        ],
      },
    });
    const frame = JSON.parse(authorizeConversationAcpFrame(raw, env));
    expect(frame.params.mcpServers[0].env).toContainEqual({
      name: "BYCODA_CONVERSATION_TOKEN",
      value: "session-secret",
    });
    expect(frame.params.mcpServers[1].env).toEqual([]);
    const prompt = JSON.stringify({
      method: "session/prompt",
      params: { text: "BYCODA_CONVERSATION_TOKEN" },
    });
    expect(authorizeConversationAcpFrame(prompt, env)).toBe(prompt);
  });
  it("bounds transport, enforces host identity and redacts credentials from failures", async () => {
    const env = {
      BYCODA_CONVERSATION_TOKEN: "session-secret",
      BYCODA_CONVERSATION_ENDPOINT: "http://127.0.0.1:1234",
      BYCODA_CONVERSATION_ENVIRONMENT: "host",
    };
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ result: { ok: true } })),
    );
    await expect(callConversationTool("tasks.list", {}, env, fetcher)).resolves.toEqual({
      ok: true,
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      environmentId: "host",
      method: "conversation.tools.call",
      params: { action: "tasks.list", input: {} },
    });
    await expect(
      callConversationTool(
        "tasks.list",
        {},
        { ...env, BYCODA_CONVERSATION_ENDPOINT: "http://untrusted.test" },
        fetcher,
      ),
    ).rejects.toThrow("endpoint");
    await expect(
      callConversationTool(
        "tasks.list",
        {},
        env,
        async () => new Response(JSON.stringify({ error: "session-secret denied" })),
      ),
    ).rejects.toThrow("[conversation credential redacted]");
  });
  it("returns screenshots as MCP image content and reports unsupported tools", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let raw = "";
    output.on("data", (chunk) => {
      raw += String(chunk);
    });
    const run = runConversationMcp(input, output, async () => ({
      mime: "image/png",
      base64: "aGVsbG8=",
    }));
    input.end(
      [
        JSON.stringify({ id: 1, method: "tools/list" }),
        JSON.stringify({
          id: 2,
          method: "tools/call",
          params: {
            name: "conversation_devices_capture",
            arguments: { deviceId: "ios", machineId: "mac" },
          },
        }),
        JSON.stringify({
          id: 3,
          method: "tools/call",
          params: { name: "conversation_tasks_delete" },
        }),
      ].join("\n") + "\n",
    );
    await run;
    const replies = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      replies[0].result.tools.some((tool: any) => tool.name === "conversation_terminals_write"),
    ).toBe(true);
    expect(replies[1].result.content[0]).toEqual({
      type: "image",
      data: "aGVsbG8=",
      mimeType: "image/png",
    });
    expect(replies[2].result.isError).toBe(true);
  });
});
