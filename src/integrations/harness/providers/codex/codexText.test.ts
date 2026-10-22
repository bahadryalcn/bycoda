import { afterEach, expect, it, vi } from "vitest";
import { runCodexTextPrompt } from "./codexText";

const state = vi.hoisted(() => ({ streamed: false, starts: [] as Record<string, unknown>[] }));
vi.mock("../../../../features/sessions/model/models", () => ({
  modelsFor: () => [{ nativeId: "available-model" }],
}));
vi.mock("../../core/child", () => ({
  resolveCodexBinary: async () => ({ path: "codex" }),
  spawnChild: vi.fn(async () => {}),
  killChild: vi.fn(async () => {}),
  watchChild: vi.fn(),
  unwatchChild: vi.fn(),
}));
vi.mock("../../core/jsonRpc", () => ({
  JsonRpcClient: class {
    constructor(
      _id: string,
      private handlers: { onNotification: (method: string, params: unknown) => void },
    ) {}
    close() {}
    async notify() {}
    async request(method: string, params: Record<string, unknown>) {
      if (method === "thread/start") return { thread: { id: "text-thread" } };
      if (method === "turn/start") {
        state.starts.push(params);
        const text = '{"subject":"Fix commit generation","body":""}';
        if (state.streamed)
          this.handlers.onNotification("item/agentMessage/delta", { delta: text });
        this.handlers.onNotification("item/completed", {
          item: { id: "message", type: "agentMessage", text },
        });
        this.handlers.onNotification("turn/completed", { turn: { status: "completed" } });
      }
      return {};
    }
  },
}));
afterEach(() => {
  state.streamed = false;
  state.starts.length = 0;
});

it("collects a completed message without streaming deltas and selects an advertised model", async () => {
  const output = await runCodexTextPrompt({
    cwd: "/repo",
    prompt: "Commit message",
    timeoutMs: 100,
  });
  expect(JSON.parse(output).subject).toBe("Fix commit generation");
  expect(state.starts[0]?.model).toBe("available-model");
});
it("does not duplicate a streamed response when the completed snapshot arrives", async () => {
  state.streamed = true;
  const output = await runCodexTextPrompt({
    cwd: "/repo",
    prompt: "Commit message",
    timeoutMs: 100,
  });
  expect(JSON.parse(output).subject).toBe("Fix commit generation");
});
