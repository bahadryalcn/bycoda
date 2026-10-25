import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
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

it("claims a relay request once across concurrent asynchronous authority checks and rejects a close during finish", async () => {
  const relay = new ConversationDesktopRelay();
  await relay.take("native");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = relay.call(
    "terminals.write",
    { terminalId: "t", data: "pwd\n" },
    "/project",
    principal,
    async () => {
      await gate;
      return true;
    },
  );
  const rejected = expect(pending).rejects.toThrow("Host stopped");
  const first = relay.take("native");
  const second = relay.take("other");
  release();
  const claimed = await Promise.all([first, second]);
  expect(claimed.flat()).toHaveLength(1);
  const [request] = claimed[0];
  const finish = relay.finish(String(request.id), {}, undefined, "native");
  relay.close();
  await expect(finish).rejects.toThrow("expired");
  await rejected;
});
describe("Conversation Tools boundary", () => {
  it("scopes lifecycle writes without accepting owner approval or source identity overrides", () => {
    for (const [action, input] of Object.entries({
      "files.rename": { path: "a", name: "b", expectedHash: "a".repeat(64) },
      "files.copy": { path: "a", destinationParent: "folder", expectedHash: "a".repeat(64) },
      "files.delete": { path: "a", expectedHash: "a".repeat(64) },
      "tasks.transfer": { taskId: "task", targetProjectId: "destination", expectedUpdatedAt: 1 },
      "tasks.delete": { taskId: "task", expectedUpdatedAt: 1 },
      "tasks.notes.resolve": {
        taskId: "task",
        noteId: "note",
        resolved: true,
        expectedUpdatedAt: 1,
      },
      "stewards.delete": { stewardId: "steward", expectedUpdatedAt: 1 },
      "stewards.decline": {
        stewardId: "steward",
        taskId: "task",
        expectedUpdatedAt: 1,
        expectedTaskUpdatedAt: 1,
      },
    })) {
      expect(() => validateConversationTool(action, input)).not.toThrow();
      expect(
        conversationToolCatalog().find((tool) => tool.action === action)?.annotations.readOnlyHint,
      ).toBe(false);
      for (const extra of [{ approved: true }, { projectId: "other" }, { discard: true }])
        expect(() => validateConversationTool(action, { ...input, ...extra })).toThrow();
    }
  });
  it("documents every catalog action without a generic fallback", () => {
    const catalog = conversationToolCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(160);
    for (const tool of catalog) {
      expect(tool.description, tool.action).not.toContain(
        "Conversation Tools operation for this session",
      );
      expect(tool.description.length, tool.action).toBeGreaterThan(100);
    }
  });
  it("accepts schema-valid editor saves larger than the old stdio line cap", async () => {
    const input = new PassThrough(),
      output = new PassThrough();
    let raw = "";
    output.on("data", (chunk) => {
      raw += String(chunk);
    });
    const call = vi.fn(async () => ({ saved: true }));
    const run = runConversationMcp(input, output, call);
    input.end(
      JSON.stringify({
        id: 1,
        method: "tools/call",
        params: {
          name: "conversation_files_write",
          arguments: {
            path: "large.txt",
            expectedHash: "a".repeat(64),
            content: "\n".repeat(200000),
          },
        },
      }) + "\n",
    );
    await run;
    expect(call).toHaveBeenCalledOnce();
    expect(JSON.parse(raw).result.isError).toBeUndefined();
  });
  it("allows task-backed crews without caller-selected identity or permission overrides", () => {
    const input = {
      taskId: "task",
      title: "Deliver",
      prompt: "Implement",
      crewDefinitionId: "crew",
      status: "queued",
    };
    expect(() => validateConversationTool("tasks.create", input)).not.toThrow();
    expect(
      conversationToolCatalog().find((tool) => tool.action === "tasks.create")?.annotations
        .readOnlyHint,
    ).toBe(false);
    for (const extra of [{ projectId: "other" }, { runtimeMode: "auto" }, { approved: true }])
      expect(() => validateConversationTool("tasks.create", { ...input, ...extra })).toThrow();
  });
  it("accepts a bounded log stream generation so cursors can recover across host restarts", () => {
    expect(() =>
      validateConversationTool("logs.read", { after: 10, streamId: "previous-host" }),
    ).not.toThrow();
    expect(() => validateConversationTool("logs.read", { streamId: "x".repeat(301) })).toThrow();
    expect(() => validateConversationTool("logs.read", { streamId: 42 })).toThrow();
  });
  it("exposes bounded skill discovery as reads without accepting paths or identity overrides", () => {
    for (const action of ["skills.search", "skills.read"]) {
      expect(
        conversationToolCatalog().find((tool) => tool.action === action)?.annotations.readOnlyHint,
      ).toBe(true);
      const input = action === "skills.read" ? { name: "review" } : { query: "layout" };
      expect(() => validateConversationTool(action, input)).not.toThrow();
      expect(() => validateConversationTool(action, { ...input, cwd: "/other" })).toThrow();
      expect(() => validateConversationTool(action, { ...input, path: "/secret" })).toThrow();
    }
    expect(() =>
      validateConversationTool("skills.read", { name: "review", maxChars: 16001 }),
    ).toThrow();
    expect(() => validateConversationTool("skills.search", { query: "x".repeat(201) })).toThrow();
  });
  it("advertises review context as a read and rejects approval flags and arbitrary nested review fields", () => {
    const input = {
      requestId: "review",
      item: { provider: "github", kind: "pr", repo: "owner/repo", number: 7 },
      commitId: "a".repeat(40),
      event: "COMMENT",
      body: "Bir sorun var.",
      comments: [{ path: "src/a.ts", line: 2, side: "LEFT", body: "Bu kontrol gerekli." }],
    };
    expect(() => validateConversationTool("inbox.review", input)).not.toThrow();
    for (const extra of [{ approved: true }, { confirm: "SEND" }, { cwd: "/foreign" }])
      expect(() => validateConversationTool("inbox.review", { ...input, ...extra })).toThrow(
        "protected",
      );
    expect(() =>
      validateConversationTool("inbox.review", {
        ...input,
        comments: [{ ...input.comments[0], command: "shell" }],
      }),
    ).toThrow("protected");
    expect(
      conversationToolCatalog().find((tool) => tool.action === "inbox.reviewContext")?.annotations
        .readOnlyHint,
    ).toBe(true);
    expect(
      conversationToolCatalog().find((tool) => tool.action === "inbox.review")?.annotations
        .readOnlyHint,
    ).toBe(false);
  });
  it("advertises staged previews and rejects injected ownership or shell fields", () => {
    const input = {
      machineId: "mac",
      requestId: "r",
      deviceId: "sim",
      url: "exp://localhost:8081",
      expectedText: "Ready",
      installExpoGo: true,
    };
    expect(() => validateConversationTool("devices.preview", input)).not.toThrow();
    for (const extra of [{ previewOwner: "other" }, { command: "arbitrary" }, { approved: true }])
      expect(() => validateConversationTool("devices.preview", { ...input, ...extra })).toThrow(
        "protected",
      );
    expect(
      conversationToolCatalog().find((tool) => tool.action === "devices.preview.status")
        ?.annotations.readOnlyHint,
    ).toBe(true);
    expect(() =>
      validateConversationTool("devices.action", {
        machineId: "mac",
        deviceId: "sim",
        action: { type: "pressElement", label: "Aç" },
      }),
    ).not.toThrow();
  });
  it("returns preview stage metadata together with its screenshot", async () => {
    const input = new PassThrough(),
      output = new PassThrough();
    let raw = "";
    output.on("data", (value) => {
      raw += String(value);
    });
    const run = runConversationMcp(input, output, async () => ({
      id: "job",
      state: "ready",
      verification: "expected-text",
      frame: { mime: "image/png", base64: "aGVsbG8=", capturedAt: "now" },
    }));
    input.end(
      JSON.stringify({
        id: 1,
        method: "tools/call",
        params: {
          name: "conversation_devices_preview_status",
          arguments: { id: "job", includeFrame: true },
        },
      }) + "\n",
    );
    await run;
    const content = JSON.parse(raw).result.content;
    expect(JSON.parse(content[0].text)).toMatchObject({
      state: "ready",
      verification: "expected-text",
      frame: { capturedAt: "now" },
    });
    expect(content[0].text).not.toContain("aGVsbG8=");
    expect(content[1]).toMatchObject({ type: "image", data: "aGVsbG8=" });
  });
  it("offers project session reads as read-only tools and rejects authority or write inputs", () => {
    for (const action of ["sessions.list", "sessions.read"]) {
      expect(
        conversationToolCatalog().find((tool) => tool.action === action)?.annotations,
      ).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
    expect(() =>
      validateConversationTool("sessions.read", { sessionId: "other", limit: 3, maxChars: 6000 }),
    ).not.toThrow();
    for (const input of [
      { sessionId: "other", projectId: "foreign" },
      { sessionId: "other", approved: true },
      { sessionId: "other", limit: 4 },
    ])
      expect(() => validateConversationTool("sessions.read", input)).toThrow();
    expect(() =>
      validateConversationTool("sessions.send", { sessionId: "other", prompt: "send" }),
    ).toThrow();
  });

  it("reads through the authenticated desktop when host grants are missing, without widening access", async () => {
    const requests: any[] = [];
    const server = createTcpServer((socket) => {
      socket.setEncoding("utf8");
      let raw = "";
      socket.on("data", (chunk) => {
        raw += chunk;
        if (!raw.includes("\n")) return;
        requests.push(JSON.parse(raw));
        socket.end(
          JSON.stringify({ ok: true, result: { sessionId: "other", busy: true, turns: [] } }) +
            "\n",
        );
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const env = {
      BYCODA_APP_ENDPOINT: `127.0.0.1:${(server.address() as AddressInfo).port}`,
      BYCODA_APP_TOKEN: "desktop-session-token",
    };
    try {
      await expect(
        callConversationTool("sessions.read", { sessionId: "other" }, env),
      ).resolves.toMatchObject({ sessionId: "other", busy: true });
      expect(requests[0]).toMatchObject({
        namespace: "app",
        action: "sessions.read",
        token: env.BYCODA_APP_TOKEN,
        input: { sessionId: "other" },
      });
      expect(requests[0].requestId).toBeTruthy();
      const catalog = (await callConversationTool("tools.list", {}, env)) as {
        tools: { action: string }[];
      };
      expect(catalog.tools.map((tool) => tool.action)).toEqual(["sessions.list", "sessions.read"]);
      await expect(
        callConversationTool("terminals.write", { terminalId: "t", data: "run" }, env),
      ).rejects.toThrow("connected");
      expect(requests).toHaveLength(1);
      await expect(
        callConversationTool(
          "sessions.read",
          { sessionId: "other" },
          { ...env, BYCODA_APP_ENDPOINT: "192.168.1.1:80" },
        ),
      ).rejects.toThrow("Invalid");
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
  it("runs the built CLI and MCP subprocesses through the same scoped RPC contract", async () => {
    const server = createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      const value = JSON.parse(raw);
      if (request.url === "/mcp/conversation") {
        expect(request.headers.authorization).toBe("Bearer test-session-secret");
        expect(value).toMatchObject({
          method: "tools/call",
          params: { name: "conversation_devices_list" },
        });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: value.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ action: "devices.list", input: value.params.arguments }),
                },
              ],
            },
          }),
        );
        return;
      }

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
        const child = spawn(process.execPath, [resolve("build/host/host.mjs"), ...args], {
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
    await expect(
      (async () => await relay.call("terminals.list", {}, "/project", principal))(),
    ).rejects.toThrow("offline");
    await relay.take("owner");
    const result = relay.call(
      "terminals.write",
      { terminalId: "terminal", data: "pwd\n" },
      "/project",
      principal,
    );
    const requests = await relay.take("owner");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      cwd: "/project",
      sessionId: "s",
      action: "terminals.write",
    });
    expect(await relay.take("owner")).toEqual([]);
    await expect(
      (async () => await relay.finish(String(requests[0].id), {}, undefined, "other"))(),
    ).rejects.toThrow();
    await relay.finish(String(requests[0].id), { accepted: true }, undefined, "owner");
    await expect(result).resolves.toEqual({ accepted: true });
    await expect((async () => await relay.finish(String(requests[0].id), {}))()).rejects.toThrow();
    relay.close();
  });
  it("rechecks claimed authority for the exact native owner and action after a pending approval", async () => {
    const relay = new ConversationDesktopRelay();
    await relay.take("native-owner");
    let authorized = true;
    const pending = relay.call(
      "ssh.workspace.approve",
      {},
      "/project",
      principal,
      () => authorized,
    );
    // Checking does not claim or deliver a request.
    expect(await relay.authorize("missing", "ssh.workspace.approve", "native-owner")).toEqual({
      authorized: false,
    });
    const request = (await relay.take("native-owner"))[0];
    const id = String(request.id);
    expect(await relay.authorize(id, "ssh.workspace.approve", "native-owner")).toEqual({
      authorized: true,
    });
    expect(await relay.authorize(id, "ssh.workspace.close.approve", "native-owner")).toEqual({
      authorized: false,
    });
    expect(await relay.authorize(id, "ssh.workspace.approve", "other-owner")).toEqual({
      authorized: false,
    });
    const time = vi.spyOn(Date, "now").mockReturnValue(Number(request.deadline));
    try {
      expect(await relay.authorize(id, "ssh.workspace.approve", "native-owner")).toEqual({
        authorized: false,
      });
    } finally {
      time.mockRestore();
    }
    authorized = false;
    expect(await relay.authorize(id, "ssh.workspace.approve", "native-owner")).toEqual({
      authorized: false,
    });
    await relay.finish(id, {}, undefined, "native-owner");
    await expect(pending).rejects.toThrow("revoked");
    expect(await relay.authorize(id, "ssh.workspace.approve", "native-owner")).toEqual({
      authorized: false,
    });
    relay.close();
  });
  it("does not deliver revoked or expired queued authority to the desktop", async () => {
    const relay = new ConversationDesktopRelay();
    await relay.take();
    let authorized = true;
    const result = relay.call(
      "terminals.write",
      { terminalId: "t", data: "pwd\n" },
      "/p",
      principal,
      () => authorized,
    );
    authorized = false;
    expect(await relay.take()).toEqual([]);
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
