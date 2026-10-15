import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  callbacks: new Map<string, (line: string) => void>(),
  messages: [] as { child: string; value: any }[],
  spawn: vi.fn(),
  kill: vi.fn(),
  failMode: false,
  failModel: false,
}));
vi.mock("../../core/child", () => ({
  resolveGeminiBinary: async () => ({ path: "/fake/gemini" }),
  spawnChild: (...args: unknown[]) => mocks.spawn(...args),
  killChild: (...args: unknown[]) => mocks.kill(...args),
  watchChild: (id: string, callback: (line: string) => void) => {
    mocks.callbacks.set(id, callback);
  },
  unwatchChild: (id: string) => {
    mocks.callbacks.delete(id);
  },
  writeChild: async (child: string, line: string) => {
    const value = JSON.parse(line);
    mocks.messages.push({ child, value });
    if (!value.method) return;
    const callback = mocks.callbacks.get(child)!;
    if (
      (value.method === "session/set_mode" && mocks.failMode) ||
      (value.method === "session/set_model" && mocks.failModel)
    ) {
      callback(
        JSON.stringify({
          jsonrpc: "2.0",
          id: value.id,
          error: { code: -32602, message: "Rejected selection" },
        }),
      );
      return;
    }
    if (value.method === "session/prompt") {
      callback(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 100,
          method: "session/request_permission",
          params: { options: [{ optionId: "allow", kind: "allow_always" }] },
        }),
      );
      callback(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 101,
          method: "fs/read_text_file",
          params: { path: "/secret" },
        }),
      );
      callback(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: '{"text":"Verified answer"}' },
            },
          },
        }),
      );
    }
    callback(
      JSON.stringify({
        jsonrpc: "2.0",
        id: value.id,
        result:
          value.method === "session/new"
            ? { sessionId: "isolated" }
            : value.method === "session/prompt"
              ? { stopReason: "end_turn" }
              : {},
      }),
    );
  },
}));
import { runGeminiTextPrompt } from "./geminiText";
beforeEach(() => {
  mocks.messages.length = 0;
  mocks.spawn.mockReset().mockResolvedValue(undefined);
  mocks.kill.mockReset().mockResolvedValue(undefined);
  mocks.failMode = false;
  mocks.failModel = false;
});
afterEach(() => mocks.callbacks.clear());
describe("Gemini isolated text ACP", () => {
  it("uses the chosen model and rejects permissions/file access without attaching social tools", async () => {
    expect(
      await runGeminiTextPrompt({
        cwd: "/empty",
        model: "gemini-owner-model",
        prompt: "Trusted public fact only",
      }),
    ).toBe('{"text":"Verified answer"}');
    expect(mocks.spawn.mock.calls[0][2]).toEqual(["--acp", "--approval-mode=plan"]);
    const values = mocks.messages.map((item) => item.value);
    expect(values.find((item) => item.method === "initialize").params.clientCapabilities).toEqual({
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
      session: { configOptions: { boolean: {} } },
    });
    expect(values.find((item) => item.method === "session/new").params.mcpServers).toEqual([]);
    expect(values.find((item) => item.method === "session/set_model").params.modelId).toBe(
      "gemini-owner-model",
    );
    expect(values.find((item) => item.id === 100 && item.result).result.outcome.outcome).toBe(
      "cancelled",
    );
    expect(values.find((item) => item.id === 101 && item.error).error.code).toBe(-32601);
    expect(mocks.kill).toHaveBeenCalled();
  });
  it.each(["mode", "model"])("does not prompt after a rejected %s selection", async (selection) => {
    mocks.failMode = selection === "mode";
    mocks.failModel = selection === "model";
    await expect(
      runGeminiTextPrompt({
        cwd: "/empty",
        model: "requested-model",
        prompt: "Prompt",
      }),
    ).rejects.toThrow("Rejected selection");
    expect(mocks.messages.some((item) => item.value.method === "session/prompt")).toBe(false);
    expect(mocks.kill).toHaveBeenCalled();
  });
});
