import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  callbacks: new Map<string, (line: string) => void>(),
  spawn: vi.fn(),
  write: vi.fn(),
  kill: vi.fn(),
  release: vi.fn(),
  log: "Custom agent loaded",
  tool: false,
  acp: false,
}));
vi.mock("../../core/child", () => ({
  acquireHarnessBridge: async () => mocks.release,
  prepareHarnessTextWorkspace: async () => ({
    cwd: "/private/text",
    logPath: "/private/text/agent.log",
  }),
  readHarnessTextFile: async () => mocks.log,
  resolveAntigravityBinary: async () => ({
    path: "/bin/agy",
    args: [],
    transport: mocks.acp ? "acp" : "stream-json",
  }),
  spawnChild: async (...args: unknown[]) => {
    mocks.spawn(...args);
    if (!mocks.acp) mocks.callbacks.get(args[0] as string)!(JSON.stringify({ event: "init" }));
  },
  writeChild: async (id: string, text: string) => {
    mocks.write(id, text);
    const callback = mocks.callbacks.get(id)!;
    if (mocks.acp) {
      const request = JSON.parse(text);
      if (!request.method) return;
      if (request.method === "session/prompt") {
        callback(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 100,
            method: "session/request_permission",
            params: {},
          }),
        );
        callback(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 101,
            method: "fs/read_text_file",
            params: { path: "/project/secret" },
          }),
        );
        callback(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "你好" },
              },
            },
          }),
        );
      }
      callback(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result:
            request.method === "session/new"
              ? {
                  sessionId: "private",
                  configOptions: [{ id: "model", category: "model", type: "select", options: [] }],
                }
              : request.method === "session/prompt"
                ? { stopReason: "end_turn" }
                : {},
        }),
      );
      return;
    }
    if (mocks.tool)
      callback(JSON.stringify({ event: "step_update", step_update: { step_type: "tool" } }));
    callback(JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "你好" } }));
  },
  killChild: async (...args: unknown[]) => {
    mocks.kill(...args);
  },
  watchChild: (id: string, callback: (line: string) => void) => {
    mocks.callbacks.set(id, callback);
  },
  unwatchChild: (id: string) => {
    mocks.callbacks.delete(id);
  },
}));
import { ANTIGRAVITY_TEXT_AGENT, runAntigravityTextPrompt } from "./antigravityText";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.log = "Custom agent loaded";
  mocks.tool = false;
  mocks.acp = false;
  mocks.callbacks.clear();
});
describe("isolated Antigravity text requests", () => {
  it("routes ACP requests to a fresh workspace, sets the selected model, and denies client tools", async () => {
    mocks.acp = true;
    expect(
      await runAntigravityTextPrompt({
        cwd: "/project",
        model: "gemini-3.8-flash-low",
        modelSettings: { model: "wrong-model" },
        prompt: "hello",
      }),
    ).toBe("你好");
    const messages = mocks.write.mock.calls.map((call) => JSON.parse(call[1]));
    expect(messages.find((item) => item.method === "session/new").params).toEqual({
      cwd: "/private/text",
      mcpServers: [],
    });
    expect(messages.filter((item) => item.method === "session/set_config_option")).toHaveLength(1);
    expect(messages.find((item) => item.method === "session/set_config_option").params.value).toBe(
      "gemini-3.8-flash-low",
    );
    expect(messages.find((item) => item.id === 100).result).toEqual({
      outcome: { outcome: "cancelled" },
    });
    expect(messages.find((item) => item.id === 101).error.code).toBe(-32601);
  });
  it("ignores unrelated CLI configuration fallback diagnostics", async () => {
    mocks.log = "Failed to resolve GeminiDir, falling back to default";
    expect(await runAntigravityTextPrompt({ cwd: "/project", prompt: "hello" })).toBe("你好");
  });
  it("uses the selected model in a private workspace without built-in tools", async () => {
    expect(
      await runAntigravityTextPrompt({
        cwd: "/user/project",
        model: "gemini-3.8-flash-low",
        prompt: "Translate hello",
      }),
    ).toBe("你好");
    expect(mocks.spawn.mock.calls[0][2]).toEqual(
      expect.arrayContaining(["--agent", "bycoda-text", "--model", "gemini-3.8-flash-low"]),
    );
    expect(mocks.spawn.mock.calls[0][3]).toBe("/private/text");
    expect(ANTIGRAVITY_TEXT_AGENT).toContain("excludeDefaultComponents: true");
    expect(ANTIGRAVITY_TEXT_AGENT).toContain("inheritMcp: false");
    expect(JSON.parse(mocks.write.mock.calls[0][1]).message.content).toBe("Translate hello");
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.callbacks.size).toBe(0);
  });
  it("rejects a silent fallback before sending user text", async () => {
    mocks.log = 'Agent "bycoda-text" not found, falling back to default';
    await expect(runAntigravityTextPrompt({ cwd: "/project", prompt: "secret" })).rejects.toThrow(
      "could not be loaded",
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("rejects unexpected tool use even if a result follows", async () => {
    mocks.tool = true;
    await expect(runAntigravityTextPrompt({ cwd: "/project", prompt: "hello" })).rejects.toThrow(
      "attempted to use a tool",
    );
  });
  it("does not launch an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAntigravityTextPrompt({ cwd: "/project", prompt: "hello", signal: controller.signal }),
    ).rejects.toThrow();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
