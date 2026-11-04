import { processConstructions } from "../processConstruction.testSupport";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { runCodexTextPrompt } from "./codexText";
import { CODEX_UTILITY_DISABLED_FEATURES } from "./codexUtilityIsolation";

const state = vi.hoisted(() => ({
  streamed: false,
  chunks: [] as string[],
  starts: [] as Record<string, unknown>[],
}));
vi.mock("../../../../features/sessions/model/models", () => ({
  modelsFor: () => [{ nativeId: "available-model" }],
}));
beforeEach(() => processConstructions.reset());
vi.mock("../../core/child", () =>
  processConstructions.mock({
    resolveCodexBinary: async () => ({ path: "codex" }),
    spawnChild: vi.fn(async () => {}),
    killChild: vi.fn(async () => {}),
    watchChild: vi.fn(),
    unwatchChild: vi.fn(),
  }),
);
vi.mock("../../core/jsonRpc", () => ({
  JsonRpcClient: class {
    constructor(
      private readonly handle: import("../../core/child").ChildProcessHandle,
      private handlers: {
        onNotification: (method: string, params: unknown) => void;
      },
    ) {
      processConstructions.client(handle);
    }
    assertProcess(handle: import("../../core/child").ChildProcessHandle) {
      if (handle !== this.handle) throw new Error("Foreign text process");
    }
    withWriter(writer: import("../../core/child").ChildTurnWriter) {
      return processConstructions.view(this.handle, writer, {
        request: this.request.bind(this),
        notify: this.notify.bind(this),
        respond: async () => undefined,
        respondError: async () => undefined,
        isClosed: false,
      });
    }
    close() {}
    async notify() {}
    async request(method: string, params: Record<string, unknown>) {
      if (method === "config/read")
        return {
          config: {
            mcp_servers: {},
            web_search: "disabled",
            features: Object.fromEntries(
              CODEX_UTILITY_DISABLED_FEATURES.map((name) => [name, false]),
            ),
          },
        };
      if (method === "mcpServerStatus/list") return { data: [], nextCursor: null };
      if (method === "thread/start") return { thread: { id: "text-thread" } };
      if (method === "turn/start") {
        state.starts.push(params);
        const text = state.chunks.length ? state.chunks.join("") : '{"subject":"Fix commit generation","body":""}';
        if (state.chunks.length) {
          for (const delta of state.chunks)
            this.handlers.onNotification("item/agentMessage/delta", { delta });
        } else if (state.streamed)
          this.handlers.onNotification("item/agentMessage/delta", {
            delta: text,
          });
        this.handlers.onNotification("item/completed", {
          item: { id: "message", type: "agentMessage", text },
        });
        this.handlers.onNotification("turn/completed", {
          turn: { status: "completed" },
        });
      }
      return {};
    }
  },
}));
afterEach(() => {
  state.streamed = false;
  state.chunks.length = 0;
  state.starts.length = 0;
});

it.each([{ chunks: ["ha", "ha"] }, { chunks: ["-", "--"] }, { chunks: ["\n", "\n"] }])(
  "preserves exact Codex utility delta chunks $chunks and emits no repeated completion snapshot",
  async ({ chunks }) => {
    state.chunks.push(...chunks);
    const emitted: string[] = [];
    const output = await runCodexTextPrompt({
      cwd: "/repo", prompt: "Exact text", timeoutMs: 1000,
      onEvent: (event) => { if (event.type === "message.delta") emitted.push(event.text); },
    });
    expect(output).toBe(chunks.join(""));
    expect(emitted.join("")).toBe(output);
  },
);

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
